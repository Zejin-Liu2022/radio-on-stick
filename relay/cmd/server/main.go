package main

import (
	"bufio"
	"crypto/subtle"
	"crypto/tls"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/hashicorp/yamux"
)

type relay struct {
	mu      sync.RWMutex
	session *yamux.Session
}

func (r *relay) install(session *yamux.Session) {
	r.mu.Lock()
	old := r.session
	r.session = session
	r.mu.Unlock()
	if old != nil {
		_ = old.Close()
	}
}

func (r *relay) open() (net.Conn, error) {
	r.mu.RLock()
	session := r.session
	r.mu.RUnlock()
	if session == nil || session.IsClosed() {
		return nil, fmt.Errorf("station relay is offline")
	}
	return session.Open()
}

func readToken(conn net.Conn, want string) error {
	var buf [64]byte
	if _, err := io.ReadFull(conn, buf[:]); err != nil {
		return err
	}
	token := strings.TrimRight(string(buf[:]), "\x00")
	if subtle.ConstantTimeCompare([]byte(token), []byte(want)) != 1 {
		return fmt.Errorf("invalid relay token")
	}
	return nil
}

func acceptStations(listener net.Listener, r *relay, token string) {
	for {
		conn, err := listener.Accept()
		if err != nil {
			log.Printf("relay accept: %v", err)
			return
		}
		go func(c net.Conn) {
			defer c.Close()
			_ = c.SetDeadline(time.Now().Add(15 * time.Second))
			if err := readToken(c, token); err != nil {
				log.Printf("relay auth rejected: %v", err)
				return
			}
			_ = c.SetDeadline(time.Time{})
			cfg := yamux.DefaultConfig()
			cfg.EnableKeepAlive = true
			cfg.KeepAliveInterval = 20 * time.Second
			cfg.ConnectionWriteTimeout = 10 * time.Second
			session, err := yamux.Server(c, cfg)
			if err != nil {
				log.Printf("relay session: %v", err)
				return
			}
			r.install(session)
			log.Printf("station relay connected")
			<-session.CloseChan()
			log.Printf("station relay disconnected")
		}(conn)
	}
}

func isUpgrade(r *http.Request) bool {
	return strings.EqualFold(r.Header.Get("Upgrade"), "websocket") ||
		strings.Contains(strings.ToLower(r.Header.Get("Connection")), "upgrade")
}

func copyHeaders(dst, src http.Header) {
	for key, values := range src {
		for _, value := range values {
			dst.Add(key, value)
		}
	}
}

func (r *relay) proxy(w http.ResponseWriter, req *http.Request) {
	stream, err := r.open()
	if err != nil {
		http.Error(w, "relay offline", http.StatusBadGateway)
		return
	}
	defer stream.Close()
	_ = stream.SetDeadline(time.Now().Add(24 * time.Hour))
	if err := req.Write(stream); err != nil {
		http.Error(w, "relay write failed", http.StatusBadGateway)
		return
	}
	reader := bufio.NewReaderSize(stream, 64*1024)
	resp, err := http.ReadResponse(reader, req)
	if err != nil {
		http.Error(w, "relay response failed", http.StatusBadGateway)
		return
	}
	if isUpgrade(req) && resp.StatusCode == http.StatusSwitchingProtocols {
		hijacker, ok := w.(http.Hijacker)
		if !ok {
			http.Error(w, "websocket unsupported", http.StatusInternalServerError)
			return
		}
		client, clientBuf, err := hijacker.Hijack()
		if err != nil {
			return
		}
		defer client.Close()
		_, _ = fmt.Fprintf(clientBuf, "HTTP/1.1 %d %s\r\n", resp.StatusCode, http.StatusText(resp.StatusCode))
		for key, values := range resp.Header {
			for _, value := range values {
				_, _ = fmt.Fprintf(clientBuf, "%s: %s\r\n", key, value)
			}
		}
		_, _ = clientBuf.WriteString("\r\n")
		_ = clientBuf.Flush()
		done := make(chan struct{}, 1)
		go func() {
			_, _ = io.Copy(stream, clientBuf)
			done <- struct{}{}
		}()
		_, _ = io.Copy(client, stream)
		<-done
		return
	}
	copyHeaders(w.Header(), resp.Header)
	w.WriteHeader(resp.StatusCode)
	_, _ = io.CopyBuffer(w, resp.Body, make([]byte, 64*1024))
}

func env(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func main() {
	token := os.Getenv("RELAY_TOKEN")
	if token == "" {
		log.Fatal("RELAY_TOKEN is required")
	}
	cert, err := tls.LoadX509KeyPair(
		env("RELAY_CERT", "/etc/radio-relay/tls/fullchain.pem"),
		env("RELAY_KEY", "/etc/radio-relay/tls/privkey.pem"),
	)
	if err != nil {
		log.Fatalf("relay certificate: %v", err)
	}
	tlsListener, err := tls.Listen(
		"tcp",
		env("RELAY_TLS_ADDR", ":9443"),
		&tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS12},
	)
	if err != nil {
		log.Fatalf("relay TLS listen: %v", err)
	}
	r := &relay{}
	go acceptStations(tlsListener, r, token)

	httpAddr := env("RELAY_HTTP_ADDR", "127.0.0.1:18081")
	server := &http.Server{
		Addr:              httpAddr,
		Handler:           http.HandlerFunc(r.proxy),
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	log.Printf("relay HTTP on %s, TLS on %s", httpAddr, tlsListener.Addr())
	log.Fatal(server.ListenAndServe())
}

