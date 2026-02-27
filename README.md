# Podcast Sponsorblocker API

Ein Web-Server, der Werbesegmente in Podcast-Episoden automatisch erkennt und markiert.

## Features

- 🎙️ Automatischer Download von Podcast-Episoden via URL
- 📁 Organisierte Dateistruktur: `downloads/Podcast/Episode/`
- 🎯 Transkription mit OpenAI Whisper (inkl. Timestamps)
- 🤖 KI-gestützte Erkennung von Werbesegmenten mit GPT-4
- 💾 SQLite-Datenbank für Caching (gleiche URL = sofortige Antwort)
- 📝 Persistente Speicherung von Transkripten und GPT-Responses
- 🚀 REST API mit Express.js
- ✂️ Automatisches Audio-Splitting für große Dateien (>25MB)

## Installation

1. **Dependencies installieren:**
```bash
npm install
```

2. **FFmpeg installieren** (benötigt für Audio-Splitting):
```bash
# macOS
brew install ffmpeg

# Ubuntu/Debian
sudo apt-get install ffmpeg

# Windows
# Download von https://ffmpeg.org/download.html
```

3. **Umgebungsvariablen konfigurieren:**
```bash
cp .env.example .env
```

Dann `.env` editieren und deinen OpenAI API Key eintragen:
```
OPENAI_API_KEY=sk-...
PORT=3000
OPENAI_MODEL=gpt-4-turbo
```

## Verwendung

### Server starten

```bash
npm start
```

Oder für Development mit Auto-Reload:
```bash
npm run dev
```

### API Endpoints

#### `GET /analyze?url=<podcast_url>`

Analysiert eine Podcast-Episode und gibt Werbesegmente zurück.

**Beispiel:**
```bash
curl "http://localhost:3000/analyze?url=https://example.com/podcast.mp3"
```

**Response:**
```json
{
  "cached": false,
  "url": "https://example.com/podcast.mp3",
  "title": "podcast.mp3",
  "segments": [
    {
      "start_ms": 754000,
      "end_ms": 912000,
      "category": "werbung",
      "description": "Sponsoren-Erwähnung von ProductX"
    }
  ]
}
```

Bei wiederholten Anfragen mit derselben URL wird `cached: true` zurückgegeben und das Ergebnis kommt direkt aus der Datenbank (ohne erneutes Processing).

#### `GET /health`

Health-Check Endpoint.

#### `GET /`

API-Dokumentation.

## Workflow

1. **URL-Check:** Prüft, ob die Podcast-URL bereits in der DB existiert
2. **Download:** Falls nicht gecacht, wird die Episode heruntergeladen
   - Erstellt Ordnerstruktur: `downloads/PodcastName/EpisodeName/`
3. **Audio-Splitting:** Große Dateien (>25MB) werden in 10-Minuten-Chunks aufgeteilt
4. **Transkription:** Audio wird mit Whisper transkribiert (mit Timestamps)
   - Speichert Transkript als `transcript_timestamped.txt` im Episode-Ordner
5. **Analyse:** GPT-4 analysiert das Transkript und identifiziert Werbesegmente
   - Speichert GPT-Response als `ad_detection_response.txt` im Episode-Ordner
6. **Cleanup:** MP3-Dateien werden gelöscht, Transkripte bleiben erhalten
7. **Speicherung:** Ergebnisse werden in SQLite gespeichert
8. **Response:** JSON mit allen gefundenen Werbesegmenten

## Dateistruktur

Nach der Verarbeitung:

```
downloads/
└── PodcastName/
    └── EpisodeName/
        ├── transcript_timestamped.txt      # Vollständiges Transkript mit Zeitstempeln
        ├── EpisodeName_chunk0_transcript_timestamped.txt  # Chunk-Transkripte
        ├── EpisodeName_chunk1_transcript_timestamped.txt
        └── ad_detection_response.txt       # GPT-4 Analyse-Ergebnis
```

MP3-Dateien werden nach der Verarbeitung automatisch gelöscht.

## Projektstruktur

```
.
├── server.js                       # Express Server & Hauptlogik
├── database.js                     # SQLite Datenbankfunktionen
├── download.js                     # Podcast Download mit Ordnerstruktur
├── split-audio.js                  # Audio-Splitting für große Dateien
├── transcribe.js                   # Whisper API Integration
├── detect-ads.js                   # GPT-4 Werbesegment-Erkennung
├── transcribe-remaining-chunks.js  # Manuelles Transkript-Tool
├── package.json
├── .env.example
├── podcasts.db                     # SQLite Datenbank
├── downloads/                      # Transkripte und Analysen
└── README.md
```

## Technologie-Stack

- **Node.js** mit ES Modules
- **Express.js** für den Web-Server
- **sql.js** für die SQLite-Datenbank
- **OpenAI API** (Whisper + GPT-4)
- **Axios** für HTTP-Requests
- **FFmpeg** für Audio-Splitting

## Manuelle Transkription

Falls einzelne Chunks manuell transkribiert werden sollen:

```bash
node transcribe-remaining-chunks.js
```

Dieses Script transkribiert verbleibende Chunks und erstellt ein vollständiges Transkript.

## Hinweise

- **Audio-Dateien:** Werden nach der Verarbeitung automatisch gelöscht (nur Transkripte bleiben)
- **Transkripte:** Werden dauerhaft im `downloads/` Ordner gespeichert
- **Audio-Splitting:** Große Dateien werden automatisch in 10-Minuten-Chunks aufgeteilt
- **Chunk-Größe:** Chunks werden auf 16kHz mono komprimiert (~5MB pro 10 Minuten)
- **Genauigkeit:** Hängt von der Qualität der Transkription und dem GPT-4 Prompt ab

## Kosten

Die Nutzung verursacht Kosten bei OpenAI:
- **Whisper:** ~$0.006 pro Minute Audio
- **GPT-4 Turbo:** ~$0.01 pro 1K Input-Tokens (abhängig von Transkriptlänge)

Beispielrechnung für 60-minütige Episode:
- Whisper: 60 × $0.006 = $0.36
- GPT-4: ~$0.05 - $0.15 (je nach Transkriptlänge)
- **Total:** ~$0.41 - $0.51 pro Episode

Durch das Caching werden wiederholte Anfragen kostenlos aus der DB beantwortet.

## Umgebungsvariablen

- `OPENAI_API_KEY`: Dein OpenAI API Key (erforderlich)
- `PORT`: Server-Port (Standard: 3000)
- `OPENAI_MODEL`: GPT-Modell für Ad-Detection (Standard: gpt-4-turbo)

## Entwicklung

**Dependencies neu installieren:**
```bash
npm install
```

**Server im Dev-Modus starten:**
```bash
npm run dev
```

**Datenbank zurücksetzen:**
```bash
rm podcasts.db
```

## Feature Requests

### `hinweis_timestamp` – Gezieltes Transkribieren ab einem Hinweis-Zeitstempel

**Motivation:**
Aktuell wird immer die gesamte Episode transkribiert, bevor die Werbesegment-Analyse stattfindet. Das ist teuer und langsam. Manchmal ist aber bereits bekannt, *wo* in der Folge eine Werbung oder ein verdächtiger Abschnitt beginnt – z. B. über Community-Meldungen, einen externen Hinweis oder einen einfachen Zeitstempel aus einer anderen Quelle.

**Beschreibung:**
Der `/analyze`-Endpoint soll um den optionalen Parameter `hinweis_timestamp` erweitert werden:

```
GET /analyze?url=<podcast_url>&hinweis_timestamp=<sekunden>
```

Ist `hinweis_timestamp` gesetzt, ändert sich der Verarbeitungs-Workflow wie folgt:

1. **Download:** Die gesamte Episode wird heruntergeladen (keine Änderung).
2. **Audio-Schnitt:** Aus der heruntergeladenen Datei wird **nur** das Segment
   `[hinweis_timestamp − 60s, hinweis_timestamp + 60s]` (± 1 Minute) ausgeschnitten.
3. **Transkription:** Nur dieses 2-Minuten-Fenster wird an Whisper geschickt.
4. **Analyse:** Nur das Transkript dieses Fensters wird an GPT-4 zur Werbesegment-Erkennung gesendet.
5. **Response:** Wie bisher – gefundene Segmente als JSON, aber mit `hinweis_timestamp`-Kontext.

**Vorteile:**
- Deutlich geringere Kosten (Whisper + GPT-4 nur für ~2 Minuten statt 60+)
- Deutlich schnellere Antwortzeit
- Nützlich, wenn ein Nutzer oder eine externe Quelle schon einen konkreten Verdachtszeitpunkt liefert

**Beispiel-Request:**
```bash
curl "http://localhost:3000/analyze?url=https://example.com/podcast.mp3&hinweis_timestamp=1830"
```
→ Transkribiert und analysiert nur den Bereich von 00:29:30 bis 00:31:30.

**Zu klären / Offene Punkte:**
- Einheit des Parameters: Sekunden (Integer) oder `HH:MM:SS`?
- Verhalten, wenn der Timestamp nahe am Anfang/Ende der Folge liegt (Clipping-Handling)
- Soll das Ergebnis separat gecacht werden (eigener DB-Key `url + hinweis_timestamp`)?
- Soll ein partielles Transkript neben dem vollständigen Transkript gespeichert werden?
