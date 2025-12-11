#!/usr/bin/env python3
"""
Transcribe the first 60 seconds of an audio file using Whisper
and save as transcription.json in the public folder.
"""

import json
import sys
import os
from pathlib import Path

try:
    import whisper
except ImportError:
    print("ERROR: Whisper not installed. Install it with:")
    print("  pip install openai-whisper")
    print("\nOr use: pip install git+https://github.com/openai/whisper.git")
    sys.exit(1)

# pydub not needed - using ffmpeg directly


def extract_first_60_seconds(audio_path, output_path):
    """Extract first 60 seconds of audio file using ffmpeg."""
    import subprocess
    
    print(f"Extracting first 60 seconds from: {audio_path}")
    
    # Use ffmpeg directly to extract first 60 seconds
    cmd = [
        'ffmpeg',
        '-i', audio_path,
        '-t', '60',  # Duration: 60 seconds
        '-acodec', 'copy',  # Copy audio codec (faster, no re-encoding)
        '-y',  # Overwrite output file
        output_path
    ]
    
    result = subprocess.run(cmd, capture_output=True, text=True)
    
    if result.returncode != 0:
        # If copy fails, try re-encoding
        print("Codec copy failed, re-encoding...")
        cmd = [
            'ffmpeg',
            '-i', audio_path,
            '-t', '60',
            '-acodec', 'libmp3lame',
            '-y',
            output_path
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise Exception(f"ffmpeg failed: {result.stderr}")
    
    print(f"Saved to: {output_path}")
    return output_path


def transcribe_audio(audio_path):
    """Transcribe audio using Whisper."""
    print(f"\nLoading Whisper model (this may take a moment on first run)...")
    model = whisper.load_model("base")  # Use "base" for speed, "small" or "medium" for better accuracy
    
    print(f"Transcribing audio: {audio_path}")
    print("This may take a minute...")
    
    result = model.transcribe(
        audio_path,
        word_timestamps=True,  # Get word-level timestamps
        language="en"  # Specify English for better accuracy
    )
    
    return result


def convert_to_json_format(whisper_result):
    """Convert Whisper output to our JSON format."""
    words = []
    
    for segment in whisper_result.get("segments", []):
        for word_info in segment.get("words", []):
            words.append({
                "word": word_info["word"].strip(),
                "start": word_info["start"],
                "end": word_info["end"]
            })
    
    return {"words": words}


def main():
    # Find the audio file
    audio_file = "public/The Picture of Dorian Gray by Oscar Wilde  Full audiobook.mp3"
    
    if not os.path.exists(audio_file):
        print(f"ERROR: Audio file not found: {audio_file}")
        print("\nPlease make sure the audio file is in the public/ folder")
        sys.exit(1)
    
    # Create temp file for 60-second clip
    temp_audio = "temp_60sec.mp3"
    output_json = "public/transcription.json"
    
    try:
        # Extract first 60 seconds
        extract_first_60_seconds(audio_file, temp_audio)
        
        # Transcribe
        result = transcribe_audio(temp_audio)
        
        # Convert to our format
        json_data = convert_to_json_format(result)
        
        # Save to public folder
        print(f"\nSaving transcription to: {output_json}")
        with open(output_json, 'w') as f:
            json.dump(json_data, f, indent=2)
        
        word_count = len(json_data["words"])
        print(f"\n✅ Success! Transcribed {word_count} words from first 60 seconds")
        print(f"📄 Saved to: {output_json}")
        print(f"\nFirst few words:")
        for word in json_data["words"][:10]:
            print(f"  {word['word']} ({word['start']:.2f}s - {word['end']:.2f}s)")
        
    finally:
        # Clean up temp file
        if os.path.exists(temp_audio):
            os.remove(temp_audio)
            print(f"\n🧹 Cleaned up temporary file")


if __name__ == "__main__":
    main()

