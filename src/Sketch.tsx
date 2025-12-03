import { useEffect, useRef } from 'react'
import p5 from 'p5'
import { createClient } from '@deepgram/sdk'
import './Sketch.css'

// TypeScript types
interface HandPos {
  x: number
  y: number
}

// Removed unused interface - ASCIIParticle is defined as a class below

const Sketch = () => {
  const containerRef = useRef<HTMLDivElement>(null)
  const sketchRef = useRef<p5 | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    // Configuration
    const PARTICLE_SIZE = 36 // Bigger text, but still made of small glowing particles

    // State variables
    let hands: any = null
    let camera: any = null
    let handPos: HandPos = { x: -1, y: -1 }
    let handDetected = false
    let useHandTracking = true

    let particles: ASCIIParticle[] = []

    // Audio and text streaming
    let audioElement: HTMLAudioElement | null = null
    let transcriptionWords: Array<{ word: string, start: number, end: number }> = []
    const fullText = "The quick brown fox jumps over the lazy dog. This is a test of the ASCII magnetic particle system. Each word appears as you hear it, creating an interactive fidget experience. You can pull and push the text with your hands, watching the characters connect magnetically like a kinetic sculpture. The text flows naturally, word by word, creating a mesmerizing visual that responds to your movements."
    let words: string[] = []
    let currentWordIndex = 0
    let wordsPerSecond = 2.5
    let lastWordTime = 0
    let streamingActive = true
    
    // Track line layout for justification
    let lineWords: number[][] = [] // Array of arrays, each containing word indices for that line
    let wordPositions: { x: number, y: number, lineIndex: number }[] = [] // Pre-calculated positions

    // ASCII Particle class
    class ASCIIParticle {
      x: number
      y: number
      char: string
      vx: number
      vy: number
      size: number
      targetX: number
      targetY: number
      springStrength: number
      highlighted: boolean
      wordIndex: number
      saved: boolean
      saveVelocity: HandPos
      jumpVelocity: number // For jump animation
      jumpTarget: number // Target jump height

      constructor(x: number, y: number, char: string, wordIndex: number = -1) {
        this.x = x
        this.y = y
        this.char = char
        this.vx = 0
        this.vy = 0
        this.size = PARTICLE_SIZE
        this.targetX = x
        this.targetY = y
        this.springStrength = 0.25 // Very strong spring to prevent overlap
        this.highlighted = false
        this.wordIndex = wordIndex
        this.saved = false
        this.saveVelocity = { x: 0, y: 0 }
        this.jumpVelocity = 0
        this.jumpTarget = 0
      }

      update(p: p5) {
        // Check if hand is near and trigger jump - each particle jumps independently
        if (useHandTracking && handDetected && handPos.x >= 0) {
          const dx = this.x - handPos.x
          const dy = this.y - handPos.y
          const distance = p.sqrt(dx * dx + dy * dy)
          const jumpRadius = 100 // Smaller radius for more individual particle response
          
          if (distance < jumpRadius) {
            // Calculate jump strength based on proximity - more granular for sparkly effect
            const proximity = 1 - distance / jumpRadius
            // Use a curve to make particles closer to hand jump more, creating sparkly effect
            const jumpStrength = Math.pow(proximity, 1.5) * 12 // Max jump of 12px (less intense)
            // Each particle responds independently based on its exact distance
            this.jumpTarget = Math.max(this.jumpTarget, jumpStrength)
          }
        }
        
        // Update jump animation - faster response for sparkly effect
        const jumpDiff = this.jumpTarget - this.jumpVelocity
        this.jumpVelocity += jumpDiff * 0.3 // Slightly faster response
        this.jumpTarget *= 0.88 // Faster decay so particles jump more independently
        
        // Apply jump to vertical position (subtract to move up)
        const jumpOffset = -this.jumpVelocity
        
        let targetDx = this.targetX - this.x
        let targetDy = this.targetY - this.y
        this.vx += targetDx * this.springStrength
        this.vy += (targetDy + jumpOffset) * this.springStrength
        
        // Prevent overlap
        for (let other of particles) {
          if (other === this || other.char === ' ' || this.char === ' ') continue
          
          const dx = this.x - other.x
          const dy = this.y - other.y
          const distance = p.sqrt(dx * dx + dy * dy)
          const sameWord = other.wordIndex === this.wordIndex
          const minDistance = sameWord ? PARTICLE_SIZE * 0.6 : PARTICLE_SIZE * 0.8
          
          if (distance > 0 && distance < minDistance) {
            const pushForce = (minDistance - distance) / minDistance * 0.2
            this.vx += (dx / distance) * pushForce
            this.vy += (dy / distance) * pushForce
          }
        }

        this.x += this.vx
        this.y += this.vy
        this.vx *= 0.92
        this.vy *= 0.92

        const margin = 20
        if (this.x < margin) {
          this.x = margin
          this.vx *= -0.5
        } else if (this.x > p.width - margin) {
          this.x = p.width - margin
          this.vx *= -0.5
        }
        
        if (this.y < margin) {
          this.y = margin
          this.vy *= -0.5
        } else if (this.y > p.height - margin) {
          this.y = p.height - margin
          this.vy *= -0.5
        }

        if (!isFinite(this.x) || !isFinite(this.y)) {
          this.x = this.targetX
          this.y = this.targetY
          this.vx = 0
          this.vy = 0
        }
      }

      draw(p: p5) {
        if (this.char === ' ') return

        // Add subtle glow effect
        p.drawingContext.shadowBlur = 4
        p.drawingContext.shadowColor = 'rgba(255, 255, 255, 0.2)'
        
        p.noStroke()
        p.fill(255, 255, 255, 255) // White
        p.textAlign(p.CENTER, p.CENTER)
        p.textSize(this.size)
        p.text(this.char, this.x, this.y)
        
        // Reset shadow
        p.drawingContext.shadowBlur = 0
      }
    }

    const addWordToParticles = (p: p5, word: string, startX: number, startY: number, wordIndex: number) => {
      const fontSize = PARTICLE_SIZE
      p.textSize(fontSize)
      p.textAlign(p.LEFT, p.BASELINE)
      
      let currentX = startX
      
      for (let i = 0; i < word.length; i++) {
        const char = word[i]
        
        // Measure actual character width
        const charWidth = p.textWidth(char)
        const x = currentX + charWidth / 2 // Center of character for drawing
        const y = startY
        
        // Very minimal offset for animation
        const offsetX = p.random(-2, 2)
        const offsetY = p.random(-2, 2)
        
        const particle = new ASCIIParticle(x + offsetX, y + offsetY, char, wordIndex)
        particle.targetX = x
        particle.targetY = y
        particles.push(particle)
        
        // Move to next character position using actual width
        currentX += charWidth
      }
    }

    // Pre-calculate all word positions with justification
    const calculateTextLayout = (p: p5) => {
      const fontSize = PARTICLE_SIZE
      p.textSize(fontSize)
      p.textAlign(p.LEFT, p.BASELINE)
      
      const textAscent = p.textAscent()
      const textDescent = p.textDescent()
      const lineHeight = textAscent + textDescent + fontSize * 0.4
      const spaceWidth = p.textWidth(' ')
      
      // Account for video container (top-right: 200px wide + 20px right margin)
      const videoWidth = 200
      const videoRight = 20
      
      // Left margin - increased to move text away from left edge
      const leftMargin = 200
      // Right margin accounts for video if text would overlap
      const rightMargin = Math.max(50, videoWidth + videoRight + 20)
      
      const maxLineWidth = p.width - leftMargin - rightMargin
      
      lineWords = []
      wordPositions = []
      
      let currentLine: number[] = []
      let currentLineWidth = 0
      
      // First pass: group words into lines
      for (let i = 0; i < words.length; i++) {
        const word = words[i]
        const wordWidth = p.textWidth(word)
        const wordWithSpace = wordWidth + (i < words.length - 1 ? spaceWidth : 0)
        
        if (currentLine.length === 0 || currentLineWidth + wordWithSpace <= maxLineWidth) {
          // Word fits on current line
          currentLine.push(i)
          currentLineWidth += wordWithSpace
        } else {
          // Start new line
          lineWords.push([...currentLine])
          currentLine = [i]
          currentLineWidth = wordWithSpace
        }
      }
      if (currentLine.length > 0) {
        lineWords.push(currentLine)
      }
      
      // Second pass: calculate justified positions
      // Center vertically on entire screen, but offset down a bit
      const totalTextHeight = lineWords.length * lineHeight
      const startY = (p.height - totalTextHeight) / 2 + textAscent + 80 // Offset down by 80px
      
      for (let lineIndex = 0; lineIndex < lineWords.length; lineIndex++) {
        const line = lineWords[lineIndex]
        const y = startY + lineIndex * lineHeight
        
        // Calculate total width of words on this line (without spaces)
        let totalWordsWidth = 0
        for (let wordIndex of line) {
          totalWordsWidth += p.textWidth(words[wordIndex])
        }
        
        // Calculate spacing for justification
        const numSpaces = line.length - 1
        const extraSpace = maxLineWidth - totalWordsWidth
        const spaceBetweenWords = numSpaces > 0 ? extraSpace / numSpaces : 0
        
        // Position each word
        let x = leftMargin
        for (let i = 0; i < line.length; i++) {
          const wordIndex = line[i]
          wordPositions[wordIndex] = { x, y, lineIndex }
          
          const wordWidth = p.textWidth(words[wordIndex])
          x += wordWidth + spaceBetweenWords
        }
      }
    }
    
    const transcribeAudioFile = async (apiKey: string) => {
      try {
        const deepgram = createClient(apiKey)
        updateHandStatus('Transcribing audio...')
        
        // Fetch the audio file
        const audioResponse = await fetch('/The Picture of Dorian Gray by Oscar Wilde  Full audiobook.mp3')
        const audioBuffer = await audioResponse.arrayBuffer()
        
        // Transcribe with word-level timestamps
        // Deepgram SDK v4 accepts buffer with mimetype
        const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
          { buffer: audioBuffer, mimetype: 'audio/mpeg' } as any,
          {
            model: 'nova-2',
            language: 'en-US',
            punctuate: true,
            diarize: false,
            paragraphs: false,
            utterances: false,
          }
        )
        
        if (error) {
          throw error
        }
        
        // Extract words with timestamps
        const transcript = result?.results?.channels?.[0]?.alternatives?.[0]
        if (transcript?.words) {
          transcriptionWords = transcript.words.map((w: any) => ({
            word: w.word,
            start: w.start,
            end: w.end
          }))
          
          words = transcriptionWords.map(w => w.word)
          console.log('Transcription complete:', words.length, 'words')
          updateHandStatus('Transcription ready')
          return true
        } else {
          throw new Error('No transcription results')
        }
      } catch (err: any) {
        console.error('Transcription error:', err)
        updateHandStatus('Transcription failed - using fallback text')
        return false
      }
    }
    
    const initializeAudio = async () => {
      audioElement = document.createElement('audio')
      audioElement.src = '/The Picture of Dorian Gray by Oscar Wilde  Full audiobook.mp3'
      audioElement.crossOrigin = 'anonymous'
      audioElement.preload = 'auto'
      audioElement.volume = 1.0 // Ensure volume is at max
      
      // Try to transcribe with Deepgram if API key is available
      const DEEPGRAM_API_KEY = import.meta.env.VITE_DEEPGRAM_API_KEY || ''
      
      if (DEEPGRAM_API_KEY) {
        const transcribed = await transcribeAudioFile(DEEPGRAM_API_KEY)
        if (!transcribed) {
          // Fallback to placeholder text
          words = fullText.split(' ').filter(w => w.length > 0)
          console.log('Using fallback text:', words.length, 'words')
        }
      } else {
        console.warn('No Deepgram API key found. Using placeholder text.')
        console.warn('To enable transcription, create a .env file with: VITE_DEEPGRAM_API_KEY=your_key')
        words = fullText.split(' ').filter(w => w.length > 0)
        console.log('Using placeholder text:', words.length, 'words')
      }
      
      // Audio event handlers
      audioElement.addEventListener('loadeddata', () => {
        console.log('Audio loaded, duration:', audioElement?.duration)
        updateHandStatus('Audio ready - click to play')
      })
      
      audioElement.addEventListener('error', (e) => {
        console.error('Audio error:', e)
        updateHandStatus('Audio error - check file path')
      })
      
      // Play button handler - set up after a short delay to ensure button exists
      setTimeout(() => {
        const playButton = document.getElementById('play-button')
        if (playButton) {
          playButton.addEventListener('click', () => {
            if (audioElement) {
              if (audioElement.paused) {
                console.log('Starting audio from button...', audioElement.src)
                audioElement.play().then(() => {
                  console.log('Audio started successfully, duration:', audioElement?.duration)
                  streamingActive = true
                  lastWordTime = Date.now()
                  currentWordIndex = 0 // Reset word index when starting
                  
                }).catch(err => {
                  console.error('Error playing audio:', err)
                  updateHandStatus('Audio play failed: ' + err.message)
                  // Try fallback - start streaming anyway
                  streamingActive = true
                  lastWordTime = Date.now()
                })
              } else {
                audioElement.pause()
              }
            }
          })
        }
      }, 200)
      
      // Update button and status when audio state changes
      audioElement.addEventListener('play', () => {
        console.log('Audio playing')
        updateHandStatus('Audio playing')
        streamingActive = true
        lastWordTime = Date.now()
        const playButton = document.getElementById('play-button')
        if (playButton) {
          playButton.textContent = '⏸ Pause'
          playButton.classList.add('playing')
        }
      })
      
      audioElement.addEventListener('pause', () => {
        console.log('Audio paused')
        streamingActive = false
        const playButton = document.getElementById('play-button')
        if (playButton) {
          playButton.textContent = '▶ Play Audio'
          playButton.classList.remove('playing')
        }
      })
      
      // Also allow spacebar to play/pause
      document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && audioElement) {
          e.preventDefault()
          const playButton = document.getElementById('play-button')
          if (playButton) {
            playButton.click() // Trigger button click
          }
        }
      })
    }
    
    const streamText = (p: p5) => {
      // Ensure words are initialized
      if (words.length === 0) {
        words = fullText.split(' ').filter(w => w.length > 0)
        console.log('Initialized words in streamText:', words.length)
      }
      
      // Recalculate layout on first word or if layout is empty
      if (wordPositions.length === 0 && words.length > 0) {
        calculateTextLayout(p)
        console.log('Layout calculated for', words.length, 'words')
      }
      
      if (currentWordIndex >= words.length) {
        return // All words displayed
      }
      
      // Sync to audio playback time using transcription timestamps if available
      if (audioElement && !audioElement.paused && audioElement.currentTime > 0) {
        const audioTimeSeconds = audioElement.currentTime
        
        if (transcriptionWords.length > 0) {
          // Use actual transcription timestamps for accurate sync
          let targetWordIndex = 0
          for (let i = 0; i < transcriptionWords.length; i++) {
            if (audioTimeSeconds >= transcriptionWords[i].start && audioTimeSeconds <= transcriptionWords[i].end) {
              targetWordIndex = i
              break
            } else if (audioTimeSeconds > transcriptionWords[i].end) {
              targetWordIndex = i + 1
            }
          }
          
          // Add words up to the current audio position
          while (currentWordIndex <= targetWordIndex && currentWordIndex < words.length) {
            const word = words[currentWordIndex]
            if (word && wordPositions[currentWordIndex]) {
              const pos = wordPositions[currentWordIndex]
              addWordToParticles(p, word, pos.x, pos.y, currentWordIndex)
            }
            currentWordIndex++
          }
        } else {
          // Fallback to estimated timing
          const estimatedWordIndex = Math.floor(audioTimeSeconds * wordsPerSecond)
          while (currentWordIndex <= estimatedWordIndex && currentWordIndex < words.length) {
            const word = words[currentWordIndex]
            if (word && wordPositions[currentWordIndex]) {
              const pos = wordPositions[currentWordIndex]
              addWordToParticles(p, word, pos.x, pos.y, currentWordIndex)
            }
            currentWordIndex++
          }
        }
        lastWordTime = Date.now()
      } else {
        // Always stream text even if audio not playing (for testing)
        const currentTime = Date.now()
        const timePerWord = 1000 / wordsPerSecond
        
        if (currentTime - lastWordTime >= timePerWord) {
          const word = words[currentWordIndex]
          
          if (word && wordPositions[currentWordIndex]) {
            const pos = wordPositions[currentWordIndex]
            addWordToParticles(p, word, pos.x, pos.y, currentWordIndex)
          }
          
          currentWordIndex++
          lastWordTime = currentTime
        }
      }
    }


    const updateHandStatus = (message: string) => {
      const statusEl = document.getElementById('hand-status')
      if (statusEl) {
        statusEl.textContent = message
        statusEl.classList.remove('success')
        if (message.includes('✓') || message.includes('ready')) {
          statusEl.classList.add('success')
        }
      }
    }

    const initializeHandTracking = () => {
      const HandsClass = (window as any).Hands
      const CameraClass = (window as any).Camera

      if (!HandsClass || !CameraClass) {
        setTimeout(initializeHandTracking, 500)
        return
      }

      const videoElement = document.getElementById('input_video') as HTMLVideoElement
      if (!videoElement) {
        updateHandStatus('Video element missing')
        useHandTracking = false
        return
      }

      try {
        updateHandStatus('Initializing camera...')
        
        hands = new HandsClass({
          locateFile: (file: string) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
          }
        })

        hands.setOptions({
          maxNumHands: 1,
          modelComplexity: 1,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5
        })

        hands.onResults((results: any) => {
          if (results && results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            const landmarks = results.multiHandLandmarks[0]
            
            if (landmarks && landmarks.length > 9) {
              const palmCenter = landmarks[9]
              
              const newX = (1 - palmCenter.x) * (sketchRef.current?.width || window.innerWidth)
              const newY = palmCenter.y * (sketchRef.current?.height || window.innerHeight)
              
              handPos.x = newX
              handPos.y = newY
              handDetected = true
              
              updateHandStatus('✓ Hand detected')
            } else {
              handDetected = false
              handPos.x = -1
              handPos.y = -1
              updateHandStatus('Hand: Not detected')
            }
          } else {
            handDetected = false
            handPos.x = -1
            handPos.y = -1
            updateHandStatus('Hand: Not detected')
          }
        })

        camera = new CameraClass(videoElement, {
          onFrame: async () => {
            if (hands && videoElement.readyState === 4) {
              await hands.send({ image: videoElement })
            }
          },
          width: 640,
          height: 480
        })
        
        camera.start()
          .then(() => {
            updateHandStatus('Camera ready - show your hand')
          })
          .catch((err: Error) => {
            console.error('Error starting camera:', err)
            updateHandStatus('Camera error - using mouse control')
            useHandTracking = false
          })
            
      } catch (error) {
        console.error('Error initializing MediaPipe:', error)
        updateHandStatus('MediaPipe initialization failed')
        useHandTracking = false
      }
    }

    const sketch = (p: p5) => {
      p.setup = () => {
        p.createCanvas(p.windowWidth, p.windowHeight)

        setTimeout(() => {
          initializeHandTracking()
          initializeAudio()
        }, 100)

        lastWordTime = p.millis()
      }

      p.draw = () => {
        p.background(0, 0, 0, 15)

        streamText(p)

        for (let particle of particles) {
          particle.update(p)
        }

        for (let particle of particles) {
          particle.draw(p)
        }

        // Subtle hand indicator
        if (useHandTracking && handDetected && handPos.x >= 0) {
          p.push()
          p.noFill()
          p.stroke(255, 255, 255, 40) // Very subtle white
          p.strokeWeight(1)
          p.circle(handPos.x, handPos.y, 20) // Small circle
          // Small dot in center
          p.fill(255, 255, 255, 60)
          p.noStroke()
          p.circle(handPos.x, handPos.y, 4)
          p.pop()
        }
      }

      p.keyPressed = () => {
        if (p.key === 'h' || p.key === 'H') {
          useHandTracking = !useHandTracking
          updateHandStatus(useHandTracking ? 'Hand tracking: ON' : 'Hand tracking: OFF (using mouse)')
        }
        if (p.key === 'r' || p.key === 'R') {
          particles = []
          currentWordIndex = 0
          lastWordTime = p.millis()
          streamingActive = true
          wordPositions = []
          lineWords = []
          calculateTextLayout(p)
        }
        if (p.key === 'p' || p.key === 'P') {
          streamingActive = !streamingActive
          if (streamingActive) {
            lastWordTime = p.millis()
          }
        }
        if (p.key === '+' || p.key === '=') {
          wordsPerSecond = Math.min(wordsPerSecond + 0.5, 10)
        }
        if (p.key === '-') {
          wordsPerSecond = Math.max(wordsPerSecond - 0.5, 0.5)
        }
      }

      p.windowResized = () => {
        p.resizeCanvas(p.windowWidth, p.windowHeight)
        // Recalculate layout on resize to fill new screen size
        wordPositions = []
        lineWords = []
        calculateTextLayout(p)
        // Reposition existing particles
        for (let particle of particles) {
          if (particle.wordIndex >= 0 && wordPositions[particle.wordIndex]) {
            const pos = wordPositions[particle.wordIndex]
            // Find character position within word
            p.textSize(PARTICLE_SIZE)
            p.textAlign(p.LEFT, p.BASELINE)
            const word = words[particle.wordIndex]
            let charX = pos.x
            for (let i = 0; i < word.length; i++) {
              if (word[i] === particle.char) {
                const charWidth = p.textWidth(particle.char)
                particle.targetX = charX + charWidth / 2
                particle.targetY = pos.y
                break
              }
              charX += p.textWidth(word[i])
            }
          }
        }
      }
    }

    sketchRef.current = new p5(sketch, containerRef.current)

    return () => {
      if (sketchRef.current) {
        sketchRef.current.remove()
      }
      if (camera) {
        camera.stop()
      }
      if (audioElement) {
        audioElement.pause()
        audioElement = null
      }
    }
  }, [])

  return (
    <div className="sketch-container">
      <div ref={containerRef} className="p5-container" />
      <div id="video-container">
        <video id="input_video"></video>
      </div>
      <div id="hand-status">Initializing...</div>
      <button id="play-button" className="play-button">▶ Play Audio</button>
    </div>
  )
}

export default Sketch

