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
  
  // Scroll offset state for smooth auto-scrolling
  const scrollOffsetRef = useRef<number>(0)
  const targetScrollOffsetRef = useRef<number>(0)
  const lastLineBottomRef = useRef<number>(0)
  
  // Hand tracking refs
  const handPosRef = useRef({ x: -1, y: -1 })
  const fingerPosRef = useRef({ x: -1, y: -1 }) // Finger tip position for highlighting
  const handDetectedRef = useRef(false)
  const isHoveringWordRef = useRef(false)
  const hoveredWordIndexRef = useRef<number | null>(null)
  const currentPoseRef = useRef<string | null>(null)
  
  // Visual feedback state
  const holdProgressRef = useRef(0) // 0-1 progress for hold gestures
  const holdTypeRef = useRef<'play' | 'pause' | null>(null)
  const swipeProgressRef = useRef(0) // Swipe distance in pixels
  const swipeDirectionRef = useRef<'left' | 'right' | null>(null)
  
  // Hand gesture state for controls
  const audioElementRef = useRef<HTMLAudioElement | null>(null)
  
  // Gesture detection - track positions and timing
  const handPositionHistoryRef = useRef<Array<{x: number, y: number, time: number}>>([])
  const lastCutoffTimeRef = useRef<number>(0)
  const lastSpinTimeRef = useRef<number>(0)
  
  // React state to track which words should be rendered
  const [visibleWords, setVisibleWords] = useState<number[]>([])
  
  // Highlight mode is always on now
  const [highlightedWords, setHighlightedWords] = useState<Set<number>>(new Set())
  const highlightedWordsRef = useRef<Set<number>>(new Set())
  const highlightModeRef = useRef(true) // Always on
  
  // Keep refs in sync with state
  useEffect(() => {
    highlightedWordsRef.current = highlightedWords
  }, [highlightedWords])

  // Function to check if we need to scroll and update scroll target
  const checkAndUpdateScroll = (wordBottomY: number) => {
    const viewportHeight = window.innerHeight
    const scrollThreshold = viewportHeight - 150 // Start scrolling when text is within 150px of bottom
    const scrollBuffer = 100 // How much space to leave at bottom after scroll
    
    // Track the last line's bottom position
    lastLineBottomRef.current = Math.max(lastLineBottomRef.current, wordBottomY)
    
    // Check if we need to scroll (accounting for current scroll offset)
    const effectiveBottom = wordBottomY - scrollOffsetRef.current
    
    if (effectiveBottom > scrollThreshold) {
      // Calculate new scroll target to bring text up
      const scrollNeeded = effectiveBottom - (viewportHeight - scrollBuffer - 150)
      targetScrollOffsetRef.current = scrollOffsetRef.current + scrollNeeded
    }
  }

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
      
      // Get word bounding rect for scroll check
      const wordRect = wordSpan.getBoundingClientRect()
      const wordBottomY = wordRect.bottom - canvasRect.top + scrollOffsetRef.current
      
      // Check if we need to scroll based on this new word
      checkAndUpdateScroll(wordBottomY)
      
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
          
          // Convert to canvas coordinates (add current scroll offset to get absolute position)
          // Center of the character horizontally, baseline vertically
          const x = charRect.left - canvasRect.left + charRect.width / 2
          const y = charRect.top - canvasRect.top + charRect.height / 2 + scrollOffsetRef.current
          
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
    let words: string[] = []
    // wordsRef will be updated when words are loaded
    let currentWordIndex = 0
    let wordsPerSecond = 2.5
    let streamingActive = true

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

      update(p: p5, scrollOffset: number = 0) {
        // Check if hand is near and trigger jump - each particle jumps independently
        // Use the visible (drawn) position for hand interaction
        let handIsNear = false
        const visibleY = this.y - scrollOffset
        if (useHandTracking && handDetected && handPos.x >= 0) {
          const dx = this.x - handPos.x
          const dy = visibleY - handPos.y
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

      draw(p: p5, scrollOffset: number = 0, isHighlighted: boolean = false, isHovered: boolean = false) {
        if (this.char === ' ') return

        // Calculate draw position with scroll offset
        const drawY = this.y - scrollOffset
        
        // Skip drawing if particle is way off screen (optimization)
        if (drawY < -100 || drawY > p.height + 100) return

        // Ensure text settings match exactly how we positioned particles
        p.textSize(this.size)
        // Use CENTER alignment since particles are positioned at character centers from DOM
        p.textAlign(p.CENTER, p.CENTER)
        
        // Liquid ink effect: multiple blur layers for blob-like appearance
        const ctx = p.drawingContext
        
        // Choose colors based on highlight and hover state
        // Highlighted: warm amber/gold color
        // Hovered: lighter amber color (preview before clicking)
        let baseColor = { r: 0, g: 0, b: 0 }
        let shadowColorBase = 'rgba(0, 0, 0,'
        
        if (isHighlighted) {
          baseColor = { r: 212, g: 140, b: 58 }
          shadowColorBase = 'rgba(212, 140, 58,'
        } else if (isHovered) {
          baseColor = { r: 230, g: 180, b: 100 }
          shadowColorBase = 'rgba(230, 180, 100,'
        }
        
        // Draw multiple layers with increasing blur for liquid ink effect
        // Outer glow layer (largest blur)
        ctx.shadowBlur = 25
        ctx.shadowColor = `${shadowColorBase} 0.15)`
        ctx.shadowOffsetX = 0
        ctx.shadowOffsetY = 0
        p.noStroke()
        p.fill(baseColor.r, baseColor.g, baseColor.b, 80) // Semi-transparent
        p.text(this.char, this.x, drawY)
        
        // Middle layer (medium blur)
        ctx.shadowBlur = 15
        ctx.shadowColor = `${shadowColorBase} 0.25)`
        p.fill(baseColor.r, baseColor.g, baseColor.b, 120)
        p.text(this.char, this.x, drawY)
        
        // Inner layer (small blur)
        ctx.shadowBlur = 8
        ctx.shadowColor = `${shadowColorBase} 0.35)`
        p.fill(baseColor.r, baseColor.g, baseColor.b, 180)
        p.text(this.char, this.x, drawY)
        
        // Core (no blur, solid)
        ctx.shadowBlur = 0
        p.fill(baseColor.r, baseColor.g, baseColor.b, 255)
        p.text(this.char, this.x, drawY)
        
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
      
      // Store in ref for gesture control
      audioElementRef.current = audioElement
      
      // Try to load transcription from JSON file first
      console.log('Attempting to load transcription from file...')
      const transcriptionLoaded = await loadTranscriptionFromFile()
      
      if (!transcriptionLoaded) {
        // No fallback - transcription file is required
        console.error('Transcription file not found')
        console.error('Please create a /public/transcription.json file')
        updateHandStatus('Error: Transcription file not found')
        words = []
        wordsRef.current = words
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
      
      // Audio can be controlled via hand gestures or spacebar
      
      // Update status when audio state changes
      audioElement.addEventListener('play', () => {
        console.log('Audio playing')
        updateHandStatus('Audio playing')
        streamingActive = true
        // Don't reset currentWordIndex - let it continue from where it was
        // This allows resuming after pause to continue from the same position
      })
      
      audioElement.addEventListener('pause', () => {
        console.log('Audio paused')
        streamingActive = false
      })
      
      // Also allow spacebar to play/pause
      document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && audioElement) {
          e.preventDefault()
          if (audioElement.paused) {
            audioElement.play().catch(err => {
              console.error('Error playing audio:', err)
              updateHandStatus('Audio play failed: ' + err.message)
            })
          } else {
            audioElement.pause()
          }
        }
      })
    }
    
    const streamText = (p: p5) => {
      // Words must be loaded from transcription file
      if (words.length === 0) {
        return // No words to display
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
    
    // Sync visible words to a specific audio time (for seeking backwards)
    const syncVisibleWordsToTime = (timeSeconds: number) => {
      if (transcriptionWords.length === 0) return
      
      // Find which words should be visible at this time
      let lastVisibleWordIndex = -1
      for (let i = 0; i < transcriptionWords.length; i++) {
        if (timeSeconds >= transcriptionWords[i].start) {
          lastVisibleWordIndex = i
        } else {
          break
        }
      }
      
      // Update currentWordIndex to match
      currentWordIndex = lastVisibleWordIndex + 1
      
      // Remove words that are beyond this time
      setVisibleWords(prev => {
        const newVisible = prev.filter(idx => idx <= lastVisibleWordIndex)
        return newVisible
      })
      
      // Remove particles for words that are no longer visible
      particles = particles.filter(p => p.wordIndex <= lastVisibleWordIndex)
      
      // Clear word refs for removed words
      for (const [idx] of wordRefs.current.entries()) {
        if (idx > lastVisibleWordIndex) {
          wordRefs.current.delete(idx)
        }
      }
      
      console.log(`Synced to time ${timeSeconds}s - showing words 0-${lastVisibleWordIndex}`)
    }
    
    // Detect hand pose based on extended fingers
    const detectHandPose = (landmarks: any[]) => {
      if (!landmarks || landmarks.length < 21) return null
      
      // Get finger landmarks - use PIP (proximal) joints for more reliable detection
      const indexTip = landmarks[8]
      const indexPip = landmarks[6]
      const indexMcp = landmarks[5]
      const middleTip = landmarks[12]
      const middlePip = landmarks[10]
      const middleMcp = landmarks[9]
      const ringTip = landmarks[16]
      const ringPip = landmarks[14]
      const ringMcp = landmarks[13]
      const pinkyTip = landmarks[20]
      const pinkyPip = landmarks[18]
      const pinkyMcp = landmarks[17]
      
      // Check if each finger is extended using multiple joints for reliability
      // Finger is extended if tip is significantly above PIP AND PIP is above MCP
      const indexExtended = (indexTip.y < indexPip.y - 0.02) && (indexPip.y < indexMcp.y)
      const middleExtended = (middleTip.y < middlePip.y - 0.02) && (middlePip.y < middleMcp.y)
      const ringExtended = (ringTip.y < ringPip.y - 0.02) && (ringPip.y < ringMcp.y)
      const pinkyExtended = (pinkyTip.y < pinkyPip.y - 0.02) && (pinkyPip.y < pinkyMcp.y)
      
      // For fist detection, check if fingers are curled (tip is BELOW pip)
      const indexCurled = indexTip.y > indexPip.y + 0.02
      const middleCurled = middleTip.y > middlePip.y + 0.02
      const ringCurled = ringTip.y > ringPip.y + 0.02
      const pinkyCurled = pinkyTip.y > pinkyPip.y + 0.02
      
      const extendedCount = [indexExtended, middleExtended, ringExtended, pinkyExtended].filter(Boolean).length
      const curledCount = [indexCurled, middleCurled, ringCurled, pinkyCurled].filter(Boolean).length
      
      // CLOSED FIST: All fingers curled (more strict detection)
      if (curledCount >= 3 && !indexExtended) {
        return 'fist'
      }
      
      // OPEN PALM: 4+ fingers extended
      if (extendedCount >= 4) {
        return 'palm'
      }
      
      // POINT: ONLY index extended, others must be curled
      if (indexExtended && !middleExtended && !ringExtended && !pinkyExtended && curledCount >= 2) {
        return 'point'
      }
      
      // PEACE SIGN: Only index and middle extended, others curled
      if (indexExtended && middleExtended && !ringExtended && !pinkyExtended) {
        return 'peace'
      }
      
      return null
    }
    
    // Track pose and movement for gesture detection
    let currentPose: string | null = null
    let poseStartTime = 0
    let isSwipeInProgress = false
    let swipeStartX = 0
    
    // Calculate hand movement velocity
    const getHandVelocity = () => {
      const history = handPositionHistoryRef.current
      if (history.length < 2) return { vx: 0, vy: 0, speed: 0 }
      
      const recent = history.slice(-5) // Last 5 positions
      if (recent.length < 2) return { vx: 0, vy: 0, speed: 0 }
      
      const oldest = recent[0]
      const newest = recent[recent.length - 1]
      const timeDiff = (newest.time - oldest.time) / 1000 // seconds
      
      if (timeDiff < 0.01) return { vx: 0, vy: 0, speed: 0 }
      
      const vx = (newest.x - oldest.x) / timeDiff
      const vy = (newest.y - oldest.y) / timeDiff
      const speed = Math.sqrt(vx * vx + vy * vy)
      
      return { vx, vy, speed }
    }
    
    // Handle all gestures based on hand pose
    const handleGestures = (landmarks: any[], handX: number, handY: number) => {
      const audio = audioElementRef.current
      if (!audio) return null
      
      const now = Date.now()
      const pose = detectHandPose(landmarks)
      
      // Always track hand position for velocity calculation
      handPositionHistoryRef.current.push({ x: handX, y: handY, time: now })
      handPositionHistoryRef.current = handPositionHistoryRef.current.filter(
        p => now - p.time < 300
      )
      
      const velocity = getHandVelocity()
      const isMovingFast = velocity.speed > 400 // pixels/second
      const isMovingHorizontally = Math.abs(velocity.vx) > Math.abs(velocity.vy) * 2
      
      // Reset pose timing if pose changed
      if (pose !== currentPose) {
        currentPose = pose
        poseStartTime = now
        isSwipeInProgress = false
      }
      
      const holdTime = now - poseStartTime
      
      // Reset visual feedback when not in a gesture
      const resetVisualFeedback = () => {
        holdProgressRef.current = 0
        holdTypeRef.current = null
        swipeProgressRef.current = 0
        swipeDirectionRef.current = null
      }
      
      // 1. OPEN PALM - Two behaviors:
      //    - If MOVING horizontally fast: SWIPE to seek
      //    - If STILL for 500ms: PLAY (when paused)
      if (pose === 'palm') {
        // Check for swipe gesture (fast horizontal movement)
        if (isMovingFast && isMovingHorizontally && now - lastSpinTimeRef.current > 1000) {
          if (!isSwipeInProgress) {
            isSwipeInProgress = true
            swipeStartX = handX
          }
          
          const swipeDistance = handX - swipeStartX
          const swipeThreshold = 150
          
          // Update swipe visual feedback
          swipeProgressRef.current = Math.min(1, Math.abs(swipeDistance) / swipeThreshold)
          swipeDirectionRef.current = swipeDistance > 0 ? 'right' : 'left'
          holdProgressRef.current = 0
          holdTypeRef.current = null
          
          // Trigger seek when swipe distance exceeds threshold
          if (Math.abs(swipeDistance) > swipeThreshold) {
            if (swipeDistance > 0) {
              audio.currentTime = Math.min(audio.duration, audio.currentTime + 5)
              updateHandStatus('🖐 Swipe → Forward 5s')
            } else {
              const newTime = Math.max(0, audio.currentTime - 5)
              audio.currentTime = newTime
              updateHandStatus('🖐 Swipe ← Back 5s')
              syncVisibleWordsToTime(newTime)
            }
            lastSpinTimeRef.current = now
            isSwipeInProgress = false
            swipeStartX = handX
            resetVisualFeedback()
            return swipeDistance > 0 ? 'seek_forward' : 'seek_back'
          }
          
          updateHandStatus(`🖐 Swiping ${swipeDistance > 0 ? '→' : '←'}`)
          return null
        }
        
        // If palm is still, use for play
        if (!isMovingFast && audio.paused) {
          const holdRequired = 600
          holdProgressRef.current = Math.min(1, holdTime / holdRequired)
          holdTypeRef.current = 'play'
          swipeProgressRef.current = 0
          swipeDirectionRef.current = null
          
          if (holdTime > holdRequired && now - lastCutoffTimeRef.current > 1500) {
            audio.play()
            updateHandStatus('🖐 Palm → Playing!')
            lastCutoffTimeRef.current = now
            resetVisualFeedback()
            return 'play'
          }
          updateHandStatus(`🖐 Hold to play...`)
        } else if (!isMovingFast && !audio.paused) {
          updateHandStatus('🖐 Palm - swipe to seek')
          resetVisualFeedback()
        }
        
        isSwipeInProgress = false
        return null
      }
      
      // 2. CLOSED FIST held STILL for 500ms = PAUSE (only when playing)
      if (pose === 'fist' && !audio.paused) {
        // Only trigger if hand is relatively still
        if (!isMovingFast) {
          const holdRequired = 600
          holdProgressRef.current = Math.min(1, holdTime / holdRequired)
          holdTypeRef.current = 'pause'
          swipeProgressRef.current = 0
          swipeDirectionRef.current = null
          
          if (holdTime > holdRequired && now - lastCutoffTimeRef.current > 1500) {
            audio.pause()
            updateHandStatus('✊ Fist → Paused!')
            lastCutoffTimeRef.current = now
            resetVisualFeedback()
            return 'pause'
          }
          updateHandStatus(`✊ Hold to pause...`)
        } else {
          // Moving too fast, reset timer
          poseStartTime = now
          resetVisualFeedback()
          updateHandStatus('✊ Hold still to pause')
        }
        return null
      }
      
      // Reset visual feedback for other poses
      resetVisualFeedback()
      
      // 3. POINT = HIGHLIGHT (handled separately in main callback)
      if (pose === 'point') {
        updateHandStatus('☝️ Pointing - highlight text')
        return 'point'
      }
      
      // 4. PEACE SIGN - just show status (not used for seeking anymore)
      if (pose === 'peace') {
        updateHandStatus('✌️ Peace sign detected')
        return null
      }
      
      // Unknown or transitional pose
      if (pose) {
        updateHandStatus(`✓ Hand detected (${pose})`)
      } else {
        updateHandStatus('✓ Hand detected')
      }
      
      return null
    }

    // Check if hand is hovering over any word for highlighting (only when pointing)
    // Find the closest word to the finger position
    const checkHandHoverOnWords = (handX: number, handY: number, isPointing: boolean) => {
      if (!isPointing) {
        isHoveringWordRef.current = false
        hoveredWordIndexRef.current = null
        return
      }
      
      // Find closest word within reach
      let closestWord: { index: number; dist: number } | null = null
      
      for (const [wordIndex, wordSpan] of wordRefs.current.entries()) {
        if (!wordSpan) continue
        const rect = wordSpan.getBoundingClientRect()
        const cx = rect.left + rect.width / 2
        const cy = rect.top + rect.height / 2
        const dist = Math.hypot(handX - cx, handY - cy)
        const hitRadius = Math.max(rect.width, rect.height) / 2 + 50 // 50px extra
        
        if (dist < hitRadius && (!closestWord || dist < closestWord.dist)) {
          closestWord = { index: wordIndex, dist }
        }
      }
      
      if (closestWord) {
        isHoveringWordRef.current = true
        if (hoveredWordIndexRef.current !== closestWord.index) {
          hoveredWordIndexRef.current = closestWord.index
          setHighlightedWords(prev => {
            if (prev.has(closestWord!.index)) return prev
            const newSet = new Set(prev)
            newSet.add(closestWord!.index)
            return newSet
          })
        }
      } else {
        isHoveringWordRef.current = false
        hoveredWordIndexRef.current = null
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
              
              // Sync to refs
              handPosRef.current = { x: newX, y: newY }
              handDetectedRef.current = true
              
              // Handle conductor and spin gestures
              const gestureResult = handleGestures(landmarks, newX, newY)
              
              // Check if hand is hovering over any word for highlighting
              // Use index finger tip position for more precise highlighting
              // Only highlight when making the point gesture
              const indexTip = landmarks[8]
              const screenWidth = sketchRef.current?.width || window.innerWidth
              const screenHeight = sketchRef.current?.height || window.innerHeight
              
              // Map camera coordinates to screen coordinates
              // X is mirrored, Y is adjusted for comfortable reach
              // Map camera Y range [0.1, 0.8] to screen Y range [0, height]
              const cameraYMin = 0.1
              const cameraYMax = 0.8
              const normalizedY = (indexTip.y - cameraYMin) / (cameraYMax - cameraYMin)
              const clampedY = Math.max(0, Math.min(1, normalizedY))
              
              // X also needs adjustment - map [0.1, 0.9] to full width
              const cameraXMin = 0.1
              const cameraXMax = 0.9
              const normalizedX = (indexTip.x - cameraXMin) / (cameraXMax - cameraXMin)
              const clampedX = Math.max(0, Math.min(1, normalizedX))
              
              const fingerX = (1 - clampedX) * screenWidth
              const fingerY = clampedY * screenHeight
              
              // Store finger position for visual indicator
              fingerPosRef.current = { x: fingerX, y: fingerY }
              currentPoseRef.current = gestureResult
              
              const isPointing = gestureResult === 'point'
              checkHandHoverOnWords(fingerX, fingerY, isPointing)
            } else {
              handDetected = false
              handPos.x = -1
              handPos.y = -1
              
              // Sync to refs
              handPosRef.current = { x: -1, y: -1 }
              handDetectedRef.current = false
              isHoveringWordRef.current = false
              hoveredWordIndexRef.current = null
              
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

        // Smooth scroll animation - lerp toward target offset
        const scrollSpeed = 0.08 // Controls how smooth/slow the scroll is (lower = smoother)
        const scrollDiff = targetScrollOffsetRef.current - scrollOffsetRef.current
        if (Math.abs(scrollDiff) > 0.5) {
          scrollOffsetRef.current += scrollDiff * scrollSpeed
          
          // Update hidden text container transform to keep measurements accurate
          const hiddenTextContainer = hiddenTextRef.current
          if (hiddenTextContainer) {
            hiddenTextContainer.style.transform = `translateY(-${scrollOffsetRef.current}px)`
          }
        }

        streamText(p)

        // Get current scroll offset for both update and draw
        const currentScrollOffset = scrollOffsetRef.current
        
        // Update particles with current scroll offset for hand interaction
        for (let particle of particles) {
          particle.update(p, currentScrollOffset)
        }

        // Draw particles with scroll offset, highlight state, and hover state
        const hoveredWordIndex = hoveredWordIndexRef.current
        const isHighlightModeOn = highlightModeRef.current
        for (let particle of particles) {
          const isHighlighted = highlightedWordsRef.current.has(particle.wordIndex)
          const isHovered = isHighlightModeOn && hoveredWordIndex === particle.wordIndex
          particle.draw(p, currentScrollOffset, isHighlighted, isHovered)
        }

        // Visual feedback for gestures - STATIC POSITIONS
        const fingerPos = fingerPosRef.current
        const currentPose = currentPoseRef.current
        const holdProgress = holdProgressRef.current
        const holdType = holdTypeRef.current
        const swipeProgress = swipeProgressRef.current
        const swipeDirection = swipeDirectionRef.current
        
        const screenCenterX = p.width / 2
        const screenCenterY = p.height / 2
        
        if (useHandTracking && handDetected) {
          p.push()
          
          // 1. POINTING - Elegant crosshair at finger position
          if (currentPose === 'point' && fingerPos.x >= 0) {
            // Soft outer glow
            for (let i = 3; i >= 0; i--) {
              p.noFill()
              p.stroke(212, 140, 58, 30 - i * 5)
              p.strokeWeight(8 - i * 2)
              p.circle(fingerPos.x, fingerPos.y, 35 + i * 8)
            }
            
            // Main ring
            p.stroke(212, 140, 58, 180)
            p.strokeWeight(2.5)
            p.circle(fingerPos.x, fingerPos.y, 28)
            
            // Elegant crosshair lines
            p.stroke(212, 140, 58, 120)
            p.strokeWeight(1.5)
            const gap = 18
            const len = 14
            p.line(fingerPos.x - gap - len, fingerPos.y, fingerPos.x - gap, fingerPos.y)
            p.line(fingerPos.x + gap, fingerPos.y, fingerPos.x + gap + len, fingerPos.y)
            p.line(fingerPos.x, fingerPos.y - gap - len, fingerPos.x, fingerPos.y - gap)
            p.line(fingerPos.x, fingerPos.y + gap, fingerPos.x, fingerPos.y + gap + len)
            
            // Center dot with glow
            p.fill(212, 140, 58, 80)
            p.noStroke()
            p.circle(fingerPos.x, fingerPos.y, 12)
            p.fill(212, 140, 58, 255)
            p.circle(fingerPos.x, fingerPos.y, 5)
          }
          
          // 2. HOLD GESTURE - Static centered ring (black & white)
          if (holdProgress > 0 && holdType) {
            const ringRadius = 60
            const ringX = screenCenterX
            const ringY = screenCenterY
            const isPlay = holdType === 'play'
            
            // Backdrop
            p.fill(255, 255, 255, 200)
            p.noStroke()
            p.circle(ringX, ringY, ringRadius * 2.5)
            
            // Background ring track
            p.noFill()
            p.stroke(230, 230, 230)
            p.strokeWeight(10)
            p.circle(ringX, ringY, ringRadius * 2)
            
            // Glow behind progress
            p.stroke(0, 0, 0, 40)
            p.strokeWeight(18)
            const startAngle = -p.HALF_PI
            const endAngle = startAngle + (holdProgress * p.TWO_PI)
            p.arc(ringX, ringY, ringRadius * 2, ringRadius * 2, startAngle, endAngle)
            
            // Main progress arc
            p.stroke(30, 30, 30)
            p.strokeWeight(10)
            p.arc(ringX, ringY, ringRadius * 2, ringRadius * 2, startAngle, endAngle)
            
            // Icon in center
            p.fill(40, 40, 40)
            p.noStroke()
            if (isPlay) {
              // Play triangle
              const triSize = 22
              p.triangle(
                ringX - triSize * 0.4, ringY - triSize,
                ringX - triSize * 0.4, ringY + triSize,
                ringX + triSize, ringY
              )
            } else {
              // Pause bars
              const barW = 10
              const barH = 28
              const barGap = 8
              p.rect(ringX - barW - barGap / 2, ringY - barH / 2, barW, barH, 3)
              p.rect(ringX + barGap / 2, ringY - barH / 2, barW, barH, 3)
            }
            
            // Label below
            p.fill(60, 60, 60)
            p.textAlign(p.CENTER, p.TOP)
            p.textSize(14)
            p.text(isPlay ? 'Hold to Play' : 'Hold to Pause', ringX, ringY + ringRadius + 20)
          }
          
          // 3. SWIPE - Centered indicator (same position as play/pause)
          if (swipeProgress > 0 && swipeDirection) {
            const ringRadius = 60
            const ringX = screenCenterX
            const ringY = screenCenterY
            const isRight = swipeDirection === 'right'
            
            // Backdrop
            p.fill(255, 255, 255, 200)
            p.noStroke()
            p.circle(ringX, ringY, ringRadius * 2.5)
            
            // Background ring track
            p.noFill()
            p.stroke(230, 230, 230)
            p.strokeWeight(10)
            p.circle(ringX, ringY, ringRadius * 2)
            
            // Progress arc
            p.stroke(0, 0, 0, 40)
            p.strokeWeight(18)
            const startAngle = -p.HALF_PI
            const endAngle = startAngle + (swipeProgress * p.TWO_PI)
            p.arc(ringX, ringY, ringRadius * 2, ringRadius * 2, startAngle, endAngle)
            
            // Main progress arc
            p.stroke(30, 30, 30)
            p.strokeWeight(10)
            p.arc(ringX, ringY, ringRadius * 2, ringRadius * 2, startAngle, endAngle)
            
            // Arrow icon in center
            p.fill(40, 40, 40)
            p.noStroke()
            
            const arrowSize = 28
            if (isRight) {
              // Right arrow (forward) >>
              p.beginShape()
              p.vertex(ringX - arrowSize * 0.3, ringY - arrowSize)
              p.vertex(ringX + arrowSize * 0.7, ringY)
              p.vertex(ringX - arrowSize * 0.3, ringY + arrowSize)
              p.vertex(ringX - arrowSize * 0.1, ringY)
              p.endShape(p.CLOSE)
              
              p.beginShape()
              p.vertex(ringX + arrowSize * 0.1, ringY - arrowSize)
              p.vertex(ringX + arrowSize * 1.1, ringY)
              p.vertex(ringX + arrowSize * 0.1, ringY + arrowSize)
              p.vertex(ringX + arrowSize * 0.3, ringY)
              p.endShape(p.CLOSE)
            } else {
              // Left arrow (backward) <<
              p.beginShape()
              p.vertex(ringX + arrowSize * 0.3, ringY - arrowSize)
              p.vertex(ringX - arrowSize * 0.7, ringY)
              p.vertex(ringX + arrowSize * 0.3, ringY + arrowSize)
              p.vertex(ringX + arrowSize * 0.1, ringY)
              p.endShape(p.CLOSE)
              
              p.beginShape()
              p.vertex(ringX - arrowSize * 0.1, ringY - arrowSize)
              p.vertex(ringX - arrowSize * 1.1, ringY)
              p.vertex(ringX - arrowSize * 0.1, ringY + arrowSize)
              p.vertex(ringX - arrowSize * 0.3, ringY)
              p.endShape(p.CLOSE)
            }
            
            // Label below
            p.fill(60, 60, 60)
            p.textAlign(p.CENTER, p.TOP)
            p.textSize(14)
            p.text(isRight ? 'Forward +5s' : 'Backward -5s', ringX, ringY + ringRadius + 20)
          }
          
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
          // Reset scroll state
          scrollOffsetRef.current = 0
          targetScrollOffsetRef.current = 0
          lastLineBottomRef.current = 0
          // Clear visible words (React will handle DOM cleanup)
          setVisibleWords([])
          wordRefs.current.clear()
          setupTextContainer(p)
          // Reset hidden text container transform
          const hiddenTextContainer = hiddenTextRef.current
          if (hiddenTextContainer) {
            hiddenTextContainer.style.transform = 'translateY(0px)'
          }
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

  // Mouse hover is disabled - highlighting only works with point gesture
  // Keep function for potential future use but don't auto-highlight
  const handleWordHover = (_isHovering: boolean, _wordIndex: number | null = null) => {
    // Highlighting now only works with the point hand gesture
    // Mouse hover does nothing
  }

  return (
    <div className="sketch-container highlight-mode">
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
                className={`word-${wordIndex} ${highlightedWords.has(wordIndex) ? 'highlighted' : ''}`}
                onMouseEnter={() => handleWordHover(true, wordIndex)}
                onMouseLeave={() => handleWordHover(false, null)}
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
      <div className="gesture-help">
        <span><span className="gesture-icon">○</span> Palm (hold still): Play</span>
        <span><span className="gesture-icon">○</span> Palm (swipe): Seek ←→</span>
        <span><span className="gesture-icon">●</span> Fist (hold still): Pause</span>
        <span><span className="gesture-icon">→</span> Point: Highlight text</span>
      </div>
    </div>
  )
}

export default Sketch

