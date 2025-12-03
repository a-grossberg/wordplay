# Real-Time Audio Transcription Setup

This app uses Deepgram to transcribe the audio file in real-time and sync the text display with the audio playback.

## Setup Instructions

1. **Get a Deepgram API Key:**
   - Sign up at https://console.deepgram.com/
   - Create a new project and get your API key
   - Deepgram offers a free tier with $200 in credits

2. **Install the Deepgram SDK:**
   ```bash
   npm install @deepgram/sdk
   ```

3. **Create a `.env` file in the root directory:**
   ```
   VITE_DEEPGRAM_API_KEY=your_api_key_here
   ```

4. **Restart the dev server:**
   ```bash
   npm run dev
   ```

## How It Works

- When the app loads, it automatically transcribes the audio file using Deepgram's file transcription API
- The transcription includes word-level timestamps
- As the audio plays, words appear on screen synced to their exact timestamps
- If no API key is provided, the app falls back to placeholder text

## Notes

- The first transcription may take a few seconds depending on the audio file length
- The transcription is cached in memory, so it only runs once per page load
- For production, consider caching transcriptions server-side to avoid repeated API calls

