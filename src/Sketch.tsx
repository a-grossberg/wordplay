import { useEffect, useRef, useState } from 'react'
import p5 from 'p5'
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
  const hiddenTextRef = useRef<HTMLDivElement>(null)
  const wordRefs = useRef<Map<number, HTMLSpanElement>>(new Map())
  const wordsRef = useRef<string[]>([])
  const createParticleRef = useRef<((x: number, y: number, char: string, wordIndex: number, charIndex: number) => void) | null>(null)
  
  // React state to track which words should be rendered
  const [visibleWords, setVisibleWords] = useState<number[]>([])
  
  // Effect to measure positions when words are rendered
  useEffect(() => {
    if (visibleWords.length === 0) return
    
    console.log(`Measuring positions for ${visibleWords.length} visible words`)
    console.log(`wordsRef.current.length: ${wordsRef.current.length}`)
    console.log(`createParticleRef.current exists: ${!!createParticleRef.current}`)
    
    const measureWordPositions = (wordIndex: number) => {
      const wordSpan = wordRefs.current.get(wordIndex)
      if (!wordSpan) {
        console.warn(`Word span not found for index ${wordIndex}`)
        return
      }
      
      const words = wordsRef.current
      const createParticle = createParticleRef.current
      if (!createParticle) {
        console.warn('createParticle callback not ready yet')
        return
      }
      
      // Get the canvas position for coordinate conversion
      const canvasRect = containerRef.current?.getBoundingClientRect()
      if (!canvasRect) {
        console.warn('Canvas rect not found')
        return
      }
      
      const word = words[wordIndex]
      if (!word) {
        console.warn(`Word at index ${wordIndex} not found in words array`)
        return
      }
      
      // Get character positions using Range API
      const textNode = wordSpan.firstChild
      if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
        console.warn(`Text node not found for word ${wordIndex}`)
        return
      }
      
      let particlesCreated = 0
      for (let i = 0; i < word.length; i++) {
        const char = word[i]
        
        // Skip spaces (they're not rendered as particles)
        if (char === ' ') continue
        
        // Create a range for this specific character
        const range = document.createRange()
        try {
          range.setStart(textNode, i)
          range.setEnd(textNode, i + 1)
          
          const charRect = range.getBoundingClientRect()
          
          // Convert to canvas coordinates
          // Center of the character horizontally, baseline vertically
          const x = charRect.left - canvasRect.left + charRect.width / 2
          const y = charRect.top - canvasRect.top + charRect.height / 2
          
          createParticle(x, y, char, wordIndex, i)
          particlesCreated++
        } catch (e) {
          console.warn(`Failed to get position for character ${i} in word ${wordIndex}:`, e)
        }
      }
      console.log(`Created ${particlesCreated} particles for word ${wordIndex}: "${word}"`)
    }
    
    // Measure all visible words with a small delay to ensure DOM is ready
    visibleWords.forEach(wordIndex => {
      setTimeout(() => {
        measureWordPositions(wordIndex)
      }, 10)
    })
  }, [visibleWords])

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
    // Fallback text (only used if transcription.json is not found)
    const fullText = "The quick brown fox jumps over the lazy dog. This is a test of the ASCII magnetic particle system. Each word appears as you hear it, creating an interactive fidget experience. You can pull and push the text with your hands, watching the characters connect magnetically like a kinetic sculpture. The text flows naturally, word by word, creating a mesmerizing visual that responds to your movements."
    let words: string[] = []
    // wordsRef will be updated when words are loaded
    let currentWordIndex = 0
    let wordsPerSecond = 2.5
    let streamingActive = true
    
    // Track line layout for justification (kept for potential future use)
    let _lineWords: number[][] = [] // Array of arrays, each containing word indices for that line
    let _wordPositions: { x: number, y: number, lineIndex: number }[] = [] // Pre-calculated positions

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
      charIndex: number // Index of this character within its word
      saved: boolean
      saveVelocity: HandPos
      jumpVelocity: number // For jump animation
      jumpTarget: number // Target jump height

      constructor(x: number, y: number, char: string, wordIndex: number = -1, charIndex: number = -1) {
        this.x = x
        this.y = y
        this.char = char
        this.vx = 0
        this.vy = 0
        this.size = PARTICLE_SIZE
        this.targetX = x
        this.targetY = y
        this.springStrength = 0.8 // Very strong spring to maintain exact spacing
        this.highlighted = false
        this.wordIndex = wordIndex
        this.charIndex = charIndex
        this.saved = false
        this.saveVelocity = { x: 0, y: 0 }
        this.jumpVelocity = 0
        this.jumpTarget = 0
      }

      update(p: p5) {
        // Check if hand is near and trigger jump - each particle jumps independently
        let handIsNear = false
        if (useHandTracking && handDetected && handPos.x >= 0) {
          const dx = this.x - handPos.x
          const dy = this.y - handPos.y
          const distance = p.sqrt(dx * dx + dy * dy)
          const jumpRadius = 100 // Smaller radius for more individual particle response
          
          if (distance < jumpRadius) {
            handIsNear = true
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
        
        // SIMPLIFIED APPROACH: Lock particles to exact positions when hand is not near
        // This prevents drift and overlap issues
        if (!handIsNear) {
          // No interaction - lock to exact position immediately (no tolerance)
          this.x = this.targetX
          this.y = this.targetY
          this.vx = 0
          this.vy = 0
          this.jumpVelocity = 0
          this.jumpTarget = 0
          return // Skip physics when locked
        }
        
        // When hand is near, still keep particles close to targets
        // Only allow small deviations for the jump effect
        
        // Only apply physics when hand is near or particle is moving
        let targetDx = this.targetX - this.x
        let targetDy = this.targetY - this.y
        
        // Very strong spring to keep particles at exact positions
        this.vx += targetDx * this.springStrength
        this.vy += (targetDy + jumpOffset) * this.springStrength
        
        // Prevent overlap - only when hand is near (otherwise particles are locked)
        if (handIsNear) {
          for (let other of particles) {
            if (other === this || other.char === ' ' || this.char === ' ') continue
            
            const sameWord = other.wordIndex === this.wordIndex
            const dx = this.x - other.x
            const dy = this.y - other.y
            const distance = p.sqrt(dx * dx + dy * dy)
            
            // Different minimum distances for same word vs different words
            const minDistance = sameWord ? PARTICLE_SIZE * 0.75 : PARTICLE_SIZE * 1.2
            
            if (distance > 0 && distance < minDistance) {
              // Stronger push for same word, weaker for different words
              const pushForce = sameWord 
                ? (minDistance - distance) / minDistance * 0.4
                : (minDistance - distance) / minDistance * 0.15
              this.vx += (dx / distance) * pushForce
              this.vy += (dy / distance) * pushForce
            }
          }
        }

        this.x += this.vx
        this.y += this.vy
        // Stronger damping to prevent drift and keep particles locked
        this.vx *= 0.85
        this.vy *= 0.85
        
        // Strong locking: if very close to target and not interacting, snap to it
        if (!handIsNear && Math.abs(this.targetX - this.x) < 2.0) {
          this.x = this.targetX
          this.vx = 0
        }
        if (!handIsNear && Math.abs(this.targetY - this.y) < 2.0) {
          this.y = this.targetY
          this.vy = 0
        }

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

        // Ensure text settings match exactly how we positioned particles
        p.textSize(this.size)
        // Use CENTER alignment since particles are positioned at character centers from DOM
        p.textAlign(p.CENTER, p.CENTER)
        
        // Liquid ink effect: multiple blur layers for blob-like appearance
        const ctx = p.drawingContext
        
        // Draw multiple layers with increasing blur for liquid ink effect
        // Outer glow layer (largest blur)
        ctx.shadowBlur = 25
        ctx.shadowColor = 'rgba(0, 0, 0, 0.15)'
        ctx.shadowOffsetX = 0
        ctx.shadowOffsetY = 0
        p.noStroke()
        p.fill(0, 0, 0, 80) // Semi-transparent black
        p.text(this.char, this.x, this.y)
        
        // Middle layer (medium blur)
        ctx.shadowBlur = 15
        ctx.shadowColor = 'rgba(0, 0, 0, 0.25)'
        p.fill(0, 0, 0, 120)
        p.text(this.char, this.x, this.y)
        
        // Inner layer (small blur)
        ctx.shadowBlur = 8
        ctx.shadowColor = 'rgba(0, 0, 0, 0.35)'
        p.fill(0, 0, 0, 180)
        p.text(this.char, this.x, this.y)
        
        // Core (no blur, solid)
        ctx.shadowBlur = 0
        p.fill(0, 0, 0, 255)
        p.text(this.char, this.x, this.y)
        
        // Reset shadow
        ctx.shadowBlur = 0
        ctx.shadowColor = 'transparent'
      }
    }

    // Function to create particles from measured positions
    const createParticleFromPosition = (x: number, y: number, char: string, wordIndex: number, charIndex: number) => {
      // Check if particles for this word already exist to prevent duplicates
      const existingParticles = particles.filter(part => part.wordIndex === wordIndex && part.charIndex === charIndex)
      if (existingParticles.length > 0) {
        return
      }
      
      const particle = new ASCIIParticle(x, y, char, wordIndex, charIndex)
      particle.targetX = x
      particle.targetY = y
      particles.push(particle)
    }
    
    // Store callback in ref so React effect can use it
    createParticleRef.current = createParticleFromPosition
    
    // Add word to visible words (React will render it, then useEffect will measure)
    const addWordToParticles = (wordIndex: number) => {
      console.log(`Adding word ${wordIndex} to visible words. Total words: ${wordsRef.current.length}`)
      setVisibleWords(prev => {
        if (prev.includes(wordIndex)) {
          console.log(`Word ${wordIndex} already visible`)
          return prev
        }
        const newVisible = [...prev, wordIndex]
        console.log(`Visible words now:`, newVisible)
        return newVisible
      })
    }

    // Set up the hidden text container to match canvas dimensions and styling
    const setupTextContainer = (p: p5) => {
      const hiddenTextContainer = hiddenTextRef.current
      if (!hiddenTextContainer) return
      
      // Match canvas dimensions
      hiddenTextContainer.style.width = `${p.width}px`
      hiddenTextContainer.style.height = `${p.height}px`
      hiddenTextContainer.style.fontSize = `${PARTICLE_SIZE}px`
      hiddenTextContainer.style.lineHeight = `${PARTICLE_SIZE * 1.5}px`
      
      // Set up margins to match canvas layout
      const videoWidth = 200
      const videoRight = 20
      const sideMargin = Math.max(50, videoWidth + videoRight + 20)
      hiddenTextContainer.style.paddingLeft = `${sideMargin}px`
      hiddenTextContainer.style.paddingRight = `${sideMargin}px`
      hiddenTextContainer.style.paddingTop = '80px'
      hiddenTextContainer.style.textAlign = 'justify'
      hiddenTextContainer.style.whiteSpace = 'normal' // Important: normal flow for justification
      hiddenTextContainer.style.wordSpacing = 'normal'
      hiddenTextContainer.style.letterSpacing = 'normal'
    }
    
    // Legacy function kept for compatibility - now just sets up container
    const _calculateTextLayout = (p: p5) => {
      setupTextContainer(p)
      // Word positions will be determined by DOM measurements
      _wordPositions = words.map(() => ({ x: 0, y: 0, lineIndex: 0 }))
    }
    
    const loadTranscriptionFromFile = async () => {
      try {
        console.log('Loading transcription from JSON file...')
        updateHandStatus('Loading transcription...')
        
        // Try to load the transcription JSON file
        // You can generate this using Whisper or other free transcription tools
        const response = await fetch('/transcription.json')
        
        if (!response.ok) {
          throw new Error(`Failed to load transcription file: ${response.status} ${response.statusText}`)
        }
        
        const data = await response.json()
        console.log('Transcription file loaded:', data)
        
        // Handle different JSON formats
        let wordsArray: Array<{ word: string, start: number, end: number }> = []
        
        if (data.words && Array.isArray(data.words)) {
          // Format: { words: [{ word: "...", start: ..., end: ... }] }
          wordsArray = data.words
        } else if (data.results?.channels?.[0]?.alternatives?.[0]?.words) {
          // Alternative format (e.g., from other transcription services)
          wordsArray = data.results.channels[0].alternatives[0].words.map((w: any) => ({
            word: w.word,
            start: w.start,
            end: w.end
          }))
        } else if (Array.isArray(data)) {
          // Format: [{ word: "...", start: ..., end: ... }]
          wordsArray = data
        } else {
          throw new Error('Unknown transcription format')
        }
        
        if (wordsArray.length === 0) {
          throw new Error('No words found in transcription file')
        }
        
        transcriptionWords = wordsArray
        words = transcriptionWords.map(w => w.word)
        wordsRef.current = words // Update React ref
        
        console.log('Transcription loaded:', words.length, 'words')
        console.log('First 20 words:', words.slice(0, 20).join(' '))
        updateHandStatus('Transcription ready')
        return true
      } catch (err: any) {
        console.error('Failed to load transcription file:', err)
        console.error('Error details:', err.message)
        updateHandStatus(`Transcription file not found: ${err.message}`)
        return false
      }
    }
    
    const initializeAudio = async () => {
      audioElement = document.createElement('audio')
      audioElement.src = '/The Picture of Dorian Gray by Oscar Wilde  Full audiobook.mp3'
      audioElement.crossOrigin = 'anonymous'
      audioElement.preload = 'auto'
      audioElement.volume = 1.0 // Ensure volume is at max
      
      // Try to load transcription from JSON file first
      console.log('Attempting to load transcription from file...')
      const transcriptionLoaded = await loadTranscriptionFromFile()
      
      if (!transcriptionLoaded) {
        // Fallback to placeholder text
        console.warn('Transcription file not found, using fallback text')
        console.warn('To use transcription, create a /public/transcription.json file')
        console.warn('See TRANSCRIPTION_SETUP.md for instructions on generating it')
        words = fullText.split(' ').filter(w => w.length > 0)
        wordsRef.current = words // Update React ref
        console.log('Using fallback text:', words.length, 'words')
      } else {
        console.log('Transcription loaded successfully! Using transcribed text.')
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
                  // Only reset if this is the first time playing (audio hasn't started yet)
                  if (audioElement && audioElement.currentTime === 0) {
                    currentWordIndex = 0 // Reset word index when starting from beginning
                  }
                  
                }).catch(err => {
                  console.error('Error playing audio:', err)
                  updateHandStatus('Audio play failed: ' + err.message)
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
        // Don't reset currentWordIndex - let it continue from where it was
        // This allows resuming after pause to continue from the same position
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
        wordsRef.current = words // Update React ref
        console.log('Initialized words in streamText:', words.length)
      }
      
      // Set up text container on first word or if not set up
      if (words.length > 0) {
        setupTextContainer(p)
      }
      
      if (currentWordIndex >= words.length) {
        return // All words displayed
      }
      
      // Sync to audio playback time using transcription timestamps if available
      // Require audio to be playing and have advanced past initial load (0.1s threshold)
      if (audioElement && !audioElement.paused && audioElement.currentTime >= 0.1) {
        const audioTimeSeconds = audioElement.currentTime
        
        if (transcriptionWords.length > 0) {
          // Use actual transcription timestamps - show words exactly at their start times
          // Find the correct word index based on audio time (handles seeking/restarting)
          let targetWordIndex = 0
          for (let i = 0; i < transcriptionWords.length; i++) {
            // Only show word when we're at or past its exact start time
            // Use strict comparison to prevent words from showing too early
            if (audioTimeSeconds >= transcriptionWords[i].start) {
              targetWordIndex = i + 1
            } else {
              break
            }
          }
          
          // Add any words that should be visible but aren't yet
          while (currentWordIndex < targetWordIndex && currentWordIndex < words.length) {
            const word = words[currentWordIndex]
            if (word) {
              // Debug logging for "the" specifically
              if (word.toLowerCase() === 'the' && currentWordIndex === 4) {
                console.log(`Showing "the" at audio time: ${audioTimeSeconds.toFixed(2)}s, expected: ${transcriptionWords[currentWordIndex].start}s`)
              }
              addWordToParticles(currentWordIndex)
            }
            currentWordIndex++
          }
        } else {
          // Fallback to estimated timing
          const estimatedWordIndex = Math.floor(audioTimeSeconds * wordsPerSecond)
          while (currentWordIndex <= estimatedWordIndex && currentWordIndex < words.length) {
            const word = words[currentWordIndex]
            if (word) {
              addWordToParticles(currentWordIndex)
            }
            currentWordIndex++
          }
        }
      }
      // Words only appear when audio is playing - no fallback streaming
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
        
        // Set up the hidden text container to match canvas
        setupTextContainer(p)

        setTimeout(() => {
          initializeHandTracking()
          initializeAudio()
        }, 100)

      }

      p.draw = () => {
        // Pure white background
        p.background(255, 255, 255, 255)

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
          p.stroke(0, 0, 0, 40) // Very subtle black
          p.strokeWeight(1)
          p.circle(handPos.x, handPos.y, 20) // Small circle
          // Small dot in center
          p.fill(0, 0, 0, 60)
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
          streamingActive = true
          _wordPositions = []
          _lineWords = []
          // Clear visible words (React will handle DOM cleanup)
          setVisibleWords([])
          wordRefs.current.clear()
          setupTextContainer(p)
        }
        if (p.key === 'p' || p.key === 'P') {
          streamingActive = !streamingActive
          if (streamingActive) {
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
        // Update text container to match new canvas size
        setupTextContainer(p)
        
        // Re-measure all existing particles from React-rendered DOM
        const canvasRect = containerRef.current?.getBoundingClientRect()
        if (!canvasRect) return
        
        // Update particle positions from DOM (React elements are already rendered)
        setTimeout(() => {
          for (let particle of particles) {
            const wordSpan = wordRefs.current.get(particle.wordIndex)
            if (!wordSpan) continue
            
            const textNode = wordSpan.firstChild
            if (!textNode || textNode.nodeType !== Node.TEXT_NODE) continue
            
            try {
              const range = document.createRange()
              range.setStart(textNode, particle.charIndex)
              range.setEnd(textNode, particle.charIndex + 1)
              
              const charRect = range.getBoundingClientRect()
              const x = charRect.left - canvasRect.left + charRect.width / 2
              const y = charRect.top - canvasRect.top + charRect.height / 2
              
              particle.targetX = x
              particle.targetY = y
              particle.x = x
              particle.y = y
            } catch (e) {
              console.warn(`Failed to reposition particle:`, e)
            }
          }
        }, 0)
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
      {/* Hidden text container for accurate character positioning - rendered with React */}
      <div 
        ref={hiddenTextRef}
        id="hidden-text-container"
        className="hidden-text-container"
      >
        {visibleWords.length > 0 && wordsRef.current.length > 0 && visibleWords.map((wordIndex) => {
          const word = wordsRef.current[wordIndex]
          if (!word) {
            console.warn(`Word at index ${wordIndex} not found. Total words: ${wordsRef.current.length}`)
            return null
          }
          
          return (
            <span key={wordIndex}>
              <span
                ref={(el) => {
                  if (el) {
                    wordRefs.current.set(wordIndex, el)
                  } else {
                    wordRefs.current.delete(wordIndex)
                  }
                }}
                className={`word-${wordIndex}`}
              >
                {word}
              </span>
              {wordIndex < wordsRef.current.length - 1 && ' '}
            </span>
          )
        })}
      </div>
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

