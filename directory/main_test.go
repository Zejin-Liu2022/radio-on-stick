package main

import "testing"

func TestNormalizeCode(t *testing.T) {
	got := normalizeCode("7k4m-9q2x j8r5t3wa")
	if got != "7K4M9Q2XJ8R5T3WA" {
		t.Fatalf("normalizeCode = %q", got)
	}
	if got := normalizeCode("ilou"); got != "110V" {
		t.Fatalf("ambiguous chars = %q", got)
	}
}

func TestCodeHashStable(t *testing.T) {
	const code = "7K4M9Q2XJ8R5T3WA"
	const want = "sha256:0_X7TG-zybtgyaiT4YFFF6jaE6OcXPtUcWkuRf7lUEM"
	if got := codeHash(code); got != want {
		t.Fatalf("codeHash = %q, want %q", got, want)
	}
}

func TestValidateStation(t *testing.T) {
	station := Station{
		Protocol:  stationProtocol,
		StationID: "st_test0001",
		Name:      "Test",
		PublicKey: "ed25519:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
		Endpoints: []Endpoint{{Kind: "direct", URL: "https://station.example"}},
	}
	if err := validateStation(station); err != nil {
		t.Fatalf("valid station rejected: %v", err)
	}
	station.Endpoints[0].URL = "http://station.example"
	if err := validateStation(station); err == nil {
		t.Fatal("http endpoint accepted")
	}
}
