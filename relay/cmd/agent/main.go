package main

import (
	"bufio"
	"crypto/tls"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/hashicorp/yamux"
)

func env(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func writeToken(conn net.Conn, token string) error {
	var buf [64]byte
	copy(buf[:], []byte(token))
	_, err := conn.Write(buf[:])
	return err
}

func isUpgrade(r *http.Request) bool {
	return strings.EqualFold(r.Header.Get("Upgrade"), "websocket") ||
		strings.Contains(strings.ToLower(r.Header.Get("Connection")), "upgrade")
}

func handleStream(stream net.Conn, localTarget string, transport *http.Transport) {
	defer stream.Close()
	reader := bufio.NewReaderSize(stream, 64*1024)
	req, err := http.ReadRequest(reader)
	if err != nil {
		return
	}
	if isUpgrade(req) {
		local, err := net.DialTimeout("tcp", localTarget, 5*time.Second)
		if err != nil {
			return
		}
		defer local.Close()
		if err := req.Write(local); err != nil {
			return
		}
		localReader := bufio.NewReaderSize(local, 64*1024)
		resp, err := http.ReadResponse(localReader, req)
		if err != nil {
			return
		}
		_, _ = fmt.Fprintf(stream, "HTTP/1.1 %d %s\r\n", resp.StatusCode, http.StatusText(resp.StatusCode))
		for key, values := range resp.Header {
			for _, value := range values {
				_, _ = fmt.Fprintf(stream, "%s: %s\r\n", key, value)
			}
		}
		_, _ = stream.Write([]byte("\r\n"))
		done := make(chan struct{}, 1)
		go func() {
			_, _ = io.Copy(local, stream)
			done <- struct{}{}
		}()
		_, _ = io.Copy(stream, localReader)
		<-done
		return
	}
	req.URL.Scheme = "http"
	req.URL.Host = localTarget
	req.RequestURI = ""
	req.Header.Del("Proxy-Connection")
	resp, err := transport.RoundTrip(req)
	if err != nil {
		_, _ = fmt.Fprintf(stream, "HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain\r\nContent-Length: 13\r\n\r\nrelay offline")
		return
	}
	defer resp.Body.Close()
	_ = resp.Write(stream)
}

func runOnce(host, port, token, localTarget string) error {
	address := net.JoinHostPort(host, port)
	dialer := &net.Dialer{Timeout: 10 * time.Second, KeepAlive: 20 * time.Second}
	conn, err := tls.DialWithDialer(dialer, "tcp", address, &tls.Config{
		ServerName: host,
		MinVersion: tls.VersionTLS12,
	})
	if err != nil {
		return err
	}
	defer conn.Close()
	if err := writeToken(conn, token); err != nil {
		return err
	}
	cfg := yamux.DefaultConfig()
	cfg.EnableKeepAlive = true
	cfg.KeepAliveInterval = 20 * time.Second
	cfg.ConnectionWriteTimeout = 10 * time.Second
	session, err := yamux.Client(conn, cfg)
	if err != nil {
		return err
	}
	defer session.Close()
	transport := &http.Transport{
		DisableCompression:  true,
		MaxIdleConns:        64,
		MaxIdleConnsPerHost: 64,
		IdleConnTimeout:     90 * time.Second,
	}
	defer transport.CloseIdleConnections()
	log.Printf("relay agent connected to %s", address)
	for {
		stream, err := session.Accept()
		if err != nil {
			return err
		}
		go handleStream(stream, localTarget, transport)
	}
}

func main() {
	host := env("RELAY_HOST", "")
	if host == "" {
		log.Fatal("RELAY_HOST is required")
	}
	port := env("RELAY_PORT", "9443")
	token := env("RELAY_TOKEN", "")
	if token == "" {
		log.Fatal("RELAY_TOKEN is required")
	}
	localTarget := env("RELAY_LOCAL", "127.0.0.1:8080")
	for {
		if err := runOnce(host, port, token, localTarget); err != nil {
			log.Printf("relay agent: %v; retrying", err)
		}
		time.Sleep(3 * time.Second)
	}
}
