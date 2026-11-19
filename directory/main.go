package main

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

const (
	stationProtocol   = "radio-station/1"
	directoryProtocol = "radio-directory/1"
	inviteProtocol    = "radio-invite/1:"
)

var (
	stationIDPattern  = regexp.MustCompile(`^st_[A-Za-z0-9_-]{4,64}$`)
	inviteHashPattern = regexp.MustCompile(`^sha256:[A-Za-z0-9_-]{43}$`)
	codePattern       = regexp.MustCompile(`^[0-9A-HJKMNP-TV-Z]{16}$`)
)

type Endpoint struct {
	Kind string `json:"kind"`
	URL  string `json:"url"`
}

type Station struct {
	Protocol     string     `json:"protocol"`
	StationID    string     `json:"station_id"`
	Name         string     `json:"name"`
	PublicKey    string     `json:"public_key"`
	Description  string     `json:"description,omitempty"`
	Capabilities []string   `json:"capabilities,omitempty"`
	Connectivity []string   `json:"connectivity,omitempty"`
	Endpoints    []Endpoint `json:"endpoints"`
	IssuedAt     string     `json:"issued_at,omitempty"`
	Signature    string     `json:"signature,omitempty"`
}

type Record struct {
	Station      Station  `json:"station"`
	InviteHashes []string `json:"invite_hashes"`
	LastSeen     int64    `json:"last_seen"`
}

type StoreFile struct {
	Records []Record `json:"records"`
}

type Store struct {
	mu      sync.RWMutex
	path    string
	records map[string]*Record
	hashes  map[string]string
}

func newStore(path string) (*Store, error) {
	s := &Store{
		path:    path,
		records: map[string]*Record{},
		hashes:  map[string]string{},
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	var file StoreFile
	if err := json.Unmarshal(raw, &file); err != nil {
		return nil, err
	}
	now := time.Now().Unix()
	for i := range file.Records {
		rec := file.Records[i]
		if rec.Station.StationID == "" {
			continue
		}
		if rec.LastSeen == 0 {
			rec.LastSeen = now
		}
		copy := rec
		s.records[copy.Station.StationID] = &copy
		for _, hash := range copy.InviteHashes {
			s.hashes[hash] = copy.Station.StationID
		}
	}
	return s, nil
}

func (s *Store) persistLocked() error {
	file := StoreFile{Records: make([]Record, 0, len(s.records))}
	for _, rec := range s.records {
		file.Records = append(file.Records, *rec)
	}
	raw, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(s.path), ".stations-*.json")
	if err != nil {
		return err
	}
	name := tmp.Name()
	defer os.Remove(name)
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(raw); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(name, s.path)
}

func (s *Store) upsert(station Station, hashes []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.records) >= 1000 {
		if _, exists := s.records[station.StationID]; !exists {
			return errors.New("directory is full")
		}
	}
	if old := s.records[station.StationID]; old != nil {
		for _, hash := range old.InviteHashes {
			delete(s.hashes, hash)
		}
	}
	rec := &Record{
		Station:      station,
		InviteHashes: append([]string(nil), hashes...),
		LastSeen:     time.Now().Unix(),
	}
	for _, hash := range hashes {
		if other, exists := s.hashes[hash]; exists && other != station.StationID {
			return errors.New("invite hash already assigned")
		}
		s.hashes[hash] = station.StationID
	}
	s.records[station.StationID] = rec
	return s.persistLocked()
}

func (s *Store) heartbeat(id string, endpoints []Endpoint, connectivity []string) (*Record, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rec := s.records[id]
	if rec == nil {
		return nil, os.ErrNotExist
	}
	if len(endpoints) > 0 {
		rec.Station.Endpoints = append([]Endpoint(nil), endpoints...)
	}
	if len(connectivity) > 0 {
		rec.Station.Connectivity = append([]string(nil), connectivity...)
	}
	rec.LastSeen = time.Now().Unix()
	if err := s.persistLocked(); err != nil {
		return nil, err
	}
	copy := *rec
	return &copy, nil
}

func (s *Store) byCodeHash(hash string) (*Record, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	id, ok := s.hashes[hash]
	if !ok {
		return nil, false
	}
	rec := s.records[id]
	if rec == nil {
		return nil, false
	}
	copy := *rec
	return &copy, true
}

func (s *Store) count() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.records)
}

func normalizeCode(raw string) string {
	var b strings.Builder
	for _, r := range strings.ToUpper(strings.TrimSpace(raw)) {
		switch r {
		case ' ', '\t', '\r', '\n', '-', '_':
			continue
		case 'I', 'L':
			r = '1'
		case 'O':
			r = '0'
		case 'U':
			r = 'V'
		}
		b.WriteRune(r)
	}
	return b.String()
}

func codeHash(code string) string {
	sum := sha256.Sum256([]byte(inviteProtocol + code))
	return "sha256:" + base64.RawURLEncoding.EncodeToString(sum[:])
}

func jsonError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error":   code,
		"message": message,
	})
}

func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		jsonError(w, http.StatusBadRequest, "bad_json", "请求 JSON 无效")
		return false
	}
	return true
}

func validEndpoint(e Endpoint) bool {
	if e.Kind != "direct" && e.Kind != "relay" {
		return false
	}
	u, err := url.Parse(e.URL)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil {
		return false
	}
	return true
}

func validateStation(st Station) error {
	if st.Protocol != stationProtocol {
		return errors.New("unsupported station protocol")
	}
	if !stationIDPattern.MatchString(st.StationID) {
		return errors.New("invalid station_id")
	}
	if strings.TrimSpace(st.Name) == "" || len(st.Name) > 80 {
		return errors.New("invalid station name")
	}
	if len(st.PublicKey) < 20 || !strings.HasPrefix(st.PublicKey, "ed25519:") {
		return errors.New("invalid public key")
	}
	if len(st.Endpoints) == 0 || len(st.Endpoints) > 8 {
		return errors.New("invalid endpoints")
	}
	for _, e := range st.Endpoints {
		if !validEndpoint(e) {
			return errors.New("endpoints must be https URLs")
		}
	}
	return nil
}

type registerRequest struct {
	Station        Station  `json:"station"`
	InviteHashes   []string `json:"invite_hashes"`
	DirectoryToken string   `json:"directory_token"`
}

type heartbeatRequest struct {
	Endpoints    []Endpoint `json:"endpoints"`
	Connectivity []string   `json:"connectivity"`
}

type resolveRequest struct {
	Code string `json:"code"`
}

type App struct {
	store         *Store
	publicURL     string
	registerToken string
	rateMu        sync.Mutex
	rate          map[string][]int64
}

func (a *App) authorized(r *http.Request, bodyToken string) bool {
	if a.registerToken == "" {
		return false
	}
	token := bodyToken
	if token == "" {
		auth := r.Header.Get("Authorization")
		if strings.HasPrefix(auth, "Bearer ") {
			token = strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))
		}
	}
	if token == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(token), []byte(a.registerToken)) == 1
}

func clientIP(r *http.Request) string {
	if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
		return strings.TrimSpace(strings.Split(forwarded, ",")[0])
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		return host
	}
	return r.RemoteAddr
}

func (a *App) allowResolve(ip string) bool {
	now := time.Now().Unix()
	cutoff := now - 60
	a.rateMu.Lock()
	defer a.rateMu.Unlock()
	items := a.rate[ip]
	kept := items[:0]
	for _, timestamp := range items {
		if timestamp >= cutoff {
			kept = append(kept, timestamp)
		}
	}
	if len(kept) >= 30 {
		a.rate[ip] = kept
		return false
	}
	a.rate[ip] = append(kept, now)
	return true
}

func (a *App) health(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":       true,
		"protocol": directoryProtocol,
		"stations": a.store.count(),
		"time":     time.Now().UTC().Format(time.RFC3339),
	})
}

func (a *App) register(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonError(w, http.StatusMethodNotAllowed, "method", "POST only")
		return
	}
	var req registerRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if !a.authorized(r, req.DirectoryToken) {
		jsonError(w, http.StatusUnauthorized, "unauthorized", "Directory 注册凭证无效")
		return
	}
	if err := validateStation(req.Station); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid_station", err.Error())
		return
	}
	if len(req.InviteHashes) == 0 || len(req.InviteHashes) > 100 {
		jsonError(w, http.StatusBadRequest, "invalid_invite", "至少需要一个邀请码哈希")
		return
	}
	seen := map[string]bool{}
	for _, hash := range req.InviteHashes {
		if !inviteHashPattern.MatchString(hash) {
			jsonError(w, http.StatusBadRequest, "invalid_invite", "邀请码哈希格式错误")
			return
		}
		if seen[hash] {
			jsonError(w, http.StatusBadRequest, "invalid_invite", "邀请码哈希重复")
			return
		}
		seen[hash] = true
	}
	if err := a.store.upsert(req.Station, req.InviteHashes); err != nil {
		if strings.Contains(err.Error(), "invite hash") {
			jsonError(w, http.StatusConflict, "invite_conflict", err.Error())
			return
		}
		jsonError(w, http.StatusInternalServerError, "store_error", "保存电台失败")
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":            true,
		"station_id":    req.Station.StationID,
		"registered_at": time.Now().UTC().Format(time.RFC3339),
	})
}

func (a *App) heartbeat(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonError(w, http.StatusMethodNotAllowed, "method", "POST only")
		return
	}
	if !a.authorized(r, "") {
		jsonError(w, http.StatusUnauthorized, "unauthorized", "Directory 注册凭证无效")
		return
	}
	id := strings.TrimPrefix(r.URL.Path, "/v1/stations/")
	id = strings.TrimSuffix(id, "/heartbeat")
	var req heartbeatRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	for _, e := range req.Endpoints {
		if !validEndpoint(e) {
			jsonError(w, http.StatusBadRequest, "invalid_endpoint", "endpoint 必须是 https")
			return
		}
	}
	rec, err := a.store.heartbeat(id, req.Endpoints, req.Connectivity)
	if errors.Is(err, os.ErrNotExist) {
		jsonError(w, http.StatusNotFound, "not_found", "电台不存在")
		return
	}
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "store_error", "保存心跳失败")
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":         true,
		"station_id": rec.Station.StationID,
		"last_seen":  time.Unix(rec.LastSeen, 0).UTC().Format(time.RFC3339),
	})
}

func (a *App) resolve(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonError(w, http.StatusMethodNotAllowed, "method", "POST only")
		return
	}
	if !a.allowResolve(clientIP(r)) {
		jsonError(w, http.StatusTooManyRequests, "resolve_rate_limited", "尝试过多，请稍后再试")
		return
	}
	var req resolveRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	code := normalizeCode(req.Code)
	if !codePattern.MatchString(code) {
		jsonError(w, http.StatusBadRequest, "invalid_code", "邀请码格式错误")
		return
	}
	rec, ok := a.store.byCodeHash(codeHash(code))
	if !ok {
		jsonError(w, http.StatusNotFound, "invalid_code", "邀请码无效")
		return
	}
	if time.Since(time.Unix(rec.LastSeen, 0)) > 15*time.Minute {
		jsonError(w, http.StatusServiceUnavailable, "station_stale", "电台暂时离线")
		return
	}
	open := map[string]any{
		"protocol": directoryProtocol,
		"station":  rec.Station,
		"join": map[string]any{
			"url":          firstEndpoint(rec.Station.Endpoints) + "/api/v1/join",
			"station_url":  firstEndpoint(rec.Station.Endpoints),
			"relay_url":    nil,
			"relay_ticket": nil,
		},
		"expires_at": time.Now().Add(5 * time.Minute).UTC().Format(time.RFC3339),
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(open)
}

func firstEndpoint(endpoints []Endpoint) string {
	for _, e := range endpoints {
		if e.Kind == "direct" {
			return strings.TrimSuffix(e.URL, "/")
		}
	}
	if len(endpoints) > 0 {
		return strings.TrimSuffix(endpoints[0].URL, "/")
	}
	return ""
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Frame-Options", "DENY")
		next.ServeHTTP(w, r)
	})
}

func main() {
	addr := env("RADIO_DIRECTORY_ADDR", "127.0.0.1:8787")
	dataPath := env("RADIO_DIRECTORY_DATA", "/var/lib/radio-directory/stations.json")
	webDir := env("RADIO_DIRECTORY_WEB", "/opt/radio-directory/web")
	publicURL := strings.TrimSuffix(env("RADIO_DIRECTORY_PUBLIC_URL", "https://join.example.com"), "/")
	registerToken := os.Getenv("RADIO_DIRECTORY_REGISTER_TOKEN")

	store, err := newStore(dataPath)
	if err != nil {
		log.Fatalf("store: %v", err)
	}
	app := &App{
		store:         store,
		publicURL:     publicURL,
		registerToken: registerToken,
		rate:          map[string][]int64{},
	}
	if registerToken == "" {
		log.Printf("warning: RADIO_DIRECTORY_REGISTER_TOKEN is empty; registration and heartbeat are disabled")
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/v1/health", app.health)
	mux.HandleFunc("/v1/resolve", app.resolve)
	mux.HandleFunc("/v1/stations", app.register)
	mux.HandleFunc("/v1/stations/", app.heartbeat)
	mux.HandleFunc("/j", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, filepath.Join(webDir, "index.html"))
	})
	mux.Handle("/", http.FileServer(http.Dir(webDir)))

	server := &http.Server{
		Addr:              addr,
		Handler:           securityHeaders(mux),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	log.Printf("radio directory listening on %s public=%s stations=%d", addr, publicURL, store.count())
	log.Fatal(server.ListenAndServe())
}

func env(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
