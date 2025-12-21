import { useEffect, useRef, useState } from 'react'
import p5 from 'p5'
import './TextMode.css'

// TypeScript types
interface HandPos {
  x: number
  y: number
}

// Removed unused interface - ASCIIParticle is defined as a class below

const TextMode = () => {
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
  const visualFeedbackFadeOutTimeRef = useRef<number | null>(null) // Time when visual should start fading
  const visualOpacityRef = useRef(1) // Current opacity of visual feedback
  const gradientExpansionRef = useRef<{ wordIndices: number[]; progress: number }>({ wordIndices: [], progress: 0 }) // Gradient expansion for hovered highlighted words (entire group)
  
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
  
  // Focus mode - when user circles highlighted text, show only that text
  const [focusMode, setFocusMode] = useState(false)
  const focusModeRef = useRef(false)
  const focusAnimationProgressRef = useRef(0) // 0-1 for transition animation
  
  // Hold-to-focus tracking
  const holdOnHighlightedStartTimeRef = useRef<number | null>(null)
  const holdOnHighlightedWordRef = useRef<number | null>(null)
  
  // Hold-to-unhighlight tracking (in focus mode)
  const holdToUnhighlightStartTimeRef = useRef<number | null>(null)
  const holdToUnhighlightWordRef = useRef<number | null>(null)
  
  // Track if audio was playing before focus mode (to resume after)
  const wasPlayingBeforeFocusRef = useRef(false)
  
  // Track if audio was playing before showing saved highlights panel
  const wasPlayingBeforePanelRef = useRef(false)
  
  // Ref for the saved highlights button to detect hover
  const savedButtonRef = useRef<HTMLButtonElement>(null)
  
  // Fly-off animation state (for saving highlights)
  const flyOffAnimationRef = useRef<{
    active: boolean;
    direction: { x: number; y: number };
    progress: number;
    savedWordIndices: number[];
  }>({ active: false, direction: { x: 0, y: 0 }, progress: 0, savedWordIndices: [] })
  
  // Saved highlights
  interface SavedHighlight {
    id: string;
    text: string;
    wordIndices: number[];
    audioTime: number;
    timestamp: Date;
  }
  const [savedHighlights, setSavedHighlights] = useState<SavedHighlight[]>([])
  const [showSavedPanel, setShowSavedPanel] = useState(false)
  const showSavedPanelRef = useRef(false)
  const [isAudioPlaying, setIsAudioPlaying] = useState(false)
  
  // Load saved highlights from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('wordplay_highlights')
    if (stored) {
      try {
        const parsed = JSON.parse(stored)
        setSavedHighlights(parsed.map((h: any) => ({
          ...h,
          timestamp: new Date(h.timestamp)
        })))
      } catch (e) {
        console.error('Error loading saved highlights:', e)
      }
    }
  }, [])
  
  // Save highlights to localStorage when they change
  useEffect(() => {
    if (savedHighlights.length > 0) {
      localStorage.setItem('wordplay_highlights', JSON.stringify(savedHighlights))
    }
  }, [savedHighlights])
  
  // Keep refs in sync with state
  useEffect(() => {
    highlightedWordsRef.current = highlightedWords
  }, [highlightedWords])
  
  useEffect(() => {
    focusModeRef.current = focusMode
  }, [focusMode])
  
  useEffect(() => {
    showSavedPanelRef.current = showSavedPanel
  }, [showSavedPanel])

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
    const PARTICLE_SIZE = 54 // Bigger text, but still made of small glowing particles

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

      draw(p: p5, scrollOffset: number = 0, opacity: number = 1) {
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
        
        // Always use black text - highlighting shows as underline, not color change
        const baseColor = { r: 0, g: 0, b: 0 }
        const shadowColorBase = 'rgba(0, 0, 0,'
        
        // Draw multiple layers with increasing blur for liquid ink effect
        // Outer glow layer (largest blur)
        ctx.shadowBlur = 25
        ctx.shadowColor = `${shadowColorBase} ${0.15 * opacity})`
        ctx.shadowOffsetX = 0
        ctx.shadowOffsetY = 0
        p.noStroke()
        p.fill(baseColor.r, baseColor.g, baseColor.b, 80 * opacity) // Semi-transparent
        p.text(this.char, this.x, drawY)
        
        // Middle layer (medium blur)
        ctx.shadowBlur = 15
        ctx.shadowColor = `${shadowColorBase} ${0.25 * opacity})`
        p.fill(baseColor.r, baseColor.g, baseColor.b, 120 * opacity)
        p.text(this.char, this.x, drawY)
        
        // Inner layer (small blur)
        ctx.shadowBlur = 8
        ctx.shadowColor = `${shadowColorBase} ${0.35 * opacity})`
        p.fill(baseColor.r, baseColor.g, baseColor.b, 180 * opacity)
        p.text(this.char, this.x, drawY)
        
        // Core (no blur, solid)
        ctx.shadowBlur = 0
        p.fill(baseColor.r, baseColor.g, baseColor.b, 255 * opacity)
        p.text(this.char, this.x, drawY)
        
        // Reset shadow
        ctx.shadowBlur = 0
        ctx.shadowColor = 'transparent'
      }

      drawWithColor(p: p5, scrollOffset: number = 0, opacity: number = 1, r: number, g: number, b: number) {
        if (this.char === ' ') return

        // Calculate draw position with scroll offset
        const drawY = this.y - scrollOffset
        
        // Skip drawing if particle is way off screen (optimization)
        if (drawY < -100 || drawY > p.height + 100) return

        // Ensure text settings match exactly how we positioned particles
        p.textSize(this.size)
        p.textAlign(p.CENTER, p.CENTER)
        
        // Liquid ink effect with custom color
        const ctx = p.drawingContext
        const shadowColorBase = `rgba(${r}, ${g}, ${b},`
        
        // Draw multiple layers with increasing blur for liquid ink effect
        ctx.shadowBlur = 25
        ctx.shadowColor = `${shadowColorBase} ${0.15 * opacity})`
        ctx.shadowOffsetX = 0
        ctx.shadowOffsetY = 0
        p.noStroke()
        p.fill(r, g, b, 80 * opacity)
        p.text(this.char, this.x, drawY)
        
        ctx.shadowBlur = 15
        ctx.shadowColor = `${shadowColorBase} ${0.25 * opacity})`
        p.fill(r, g, b, 120 * opacity)
        p.text(this.char, this.x, drawY)
        
        ctx.shadowBlur = 8
        ctx.shadowColor = `${shadowColorBase} ${0.35 * opacity})`
        p.fill(r, g, b, 180 * opacity)
        p.text(this.char, this.x, drawY)
        
        ctx.shadowBlur = 0
        p.fill(r, g, b, 255 * opacity)
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
      
      // Set Montserrat font to match p5.js canvas
      hiddenTextContainer.style.fontFamily = "'Montserrat', sans-serif"
      
      // Set up margins to match canvas layout
      const videoWidth = 200
      const videoRight = 20
      const gesturePanelWidth = 200
      const rightMargin = Math.max(videoWidth, gesturePanelWidth) + videoRight + 40 // Extra space for comfort
      const sideMargin = Math.max(50, rightMargin)
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
      
      // Track audio playback state for header visibility
      audioElement.addEventListener('play', () => {
        setIsAudioPlaying(true)
      })
      audioElement.addEventListener('pause', () => {
        setIsAudioPlaying(false)
      })
      audioElement.addEventListener('ended', () => {
        setIsAudioPlaying(false)
      })
      
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
      // Use stricter thresholds for better distinction
      const indexExtended = (indexTip.y < indexPip.y - 0.03) && (indexPip.y < indexMcp.y - 0.01)
      const middleExtended = (middleTip.y < middlePip.y - 0.03) && (middlePip.y < middleMcp.y - 0.01)
      const ringExtended = (ringTip.y < ringPip.y - 0.03) && (ringPip.y < ringMcp.y - 0.01)
      const pinkyExtended = (pinkyTip.y < pinkyPip.y - 0.03) && (pinkyPip.y < pinkyMcp.y - 0.01)
      
      // For fist detection, check if fingers are curled (tip is BELOW pip)
      // Use stricter thresholds - fingers must be clearly curled
      const indexCurled = indexTip.y > indexPip.y + 0.04
      const middleCurled = middleTip.y > middlePip.y + 0.04
      const ringCurled = ringTip.y > ringPip.y + 0.04
      const pinkyCurled = pinkyTip.y > pinkyPip.y + 0.04
      
      // Check index finger extension strength (how clearly extended it is)
      const indexExtensionStrength = indexPip.y - indexTip.y
      const isIndexStronglyExtended = indexExtensionStrength > 0.05
      
      const extendedCount = [indexExtended, middleExtended, ringExtended, pinkyExtended].filter(Boolean).length
      const curledCount = [indexCurled, middleCurled, ringCurled, pinkyCurled].filter(Boolean).length
      
      // PRIORITY 1: POINT - If index is clearly extended, prioritize pointing over fist
      // This prevents accidental pause when highlighting
      if (isIndexStronglyExtended && indexExtended) {
        // If index is strongly extended and others are not extended, it's a point
        if (!middleExtended && !ringExtended && !pinkyExtended) {
          return 'point'
        }
      }
      
      // PRIORITY 2: CLOSED FIST - All fingers must be clearly curled (stricter)
      // Require at least 4 out of 4 fingers to be curled, and index must NOT be extended
      if (curledCount >= 4 && !indexExtended && !isIndexStronglyExtended) {
        return 'fist'
      }
      
      // PRIORITY 3: OPEN PALM - 4+ fingers extended
      if (extendedCount >= 4) {
        return 'palm'
      }
      
      // PRIORITY 4: POINT (fallback) - Index extended, others not extended
      if (indexExtended && !middleExtended && !ringExtended && !pinkyExtended) {
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
    let poseHistory: Array<{ pose: string | null; time: number }> = [] // Track recent poses to prevent false positives
    
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
      const isMovingDiagonally = isMovingFast && 
        Math.abs(velocity.vx) > 200 && 
        Math.abs(velocity.vy) > 200 // Both directions have significant movement
      
      // Reset pose timing if pose changed
      if (pose !== currentPose) {
        currentPose = pose
        poseStartTime = now
        isSwipeInProgress = false
        
        // Track pose history (keep last 2 seconds)
        poseHistory.push({ pose, time: now })
        poseHistory = poseHistory.filter(entry => now - entry.time < 2000)
      }
      
      const holdTime = now - poseStartTime
      
      // Check if user was recently pointing (within last 500ms) - indicates highlighting, not pausing
      const wasRecentlyPointing = poseHistory.some(entry => 
        entry.pose === 'point' && (now - entry.time) < 500
      )
      
      // Reset visual feedback when not in a gesture
      const resetVisualFeedback = () => {
        holdProgressRef.current = 0
        holdTypeRef.current = null
        swipeProgressRef.current = 0
        swipeDirectionRef.current = null
        visualOpacityRef.current = 1
        visualFeedbackFadeOutTimeRef.current = null
      }
      
      // DIAGONAL SWIPE IN FOCUS MODE = SAVE & FLY OFF
      if (focusModeRef.current && pose === 'palm' && isMovingDiagonally && highlightedWordsRef.current.size > 0) {
        if (!flyOffAnimationRef.current.active) {
          // Calculate normalized direction
          const magnitude = Math.sqrt(velocity.vx * velocity.vx + velocity.vy * velocity.vy)
          const dirX = velocity.vx / magnitude
          const dirY = velocity.vy / magnitude
          
          // Trigger fly-off animation and save
          flyOffAnimationRef.current = {
            active: true,
            direction: { x: dirX, y: dirY },
            progress: 0,
            savedWordIndices: Array.from(highlightedWordsRef.current)
          }
          
          // Get the highlighted words text
          const highlightedText = Array.from(highlightedWordsRef.current)
            .sort((a, b) => a - b)
            .map(idx => wordsRef.current[idx] || '')
            .join(' ')
          
          // Get current audio time
          const audioTime = audioElementRef.current?.currentTime || 0
          
          // Save to highlights
          const newHighlight: SavedHighlight = {
            id: `highlight_${Date.now()}`,
            text: highlightedText,
            wordIndices: Array.from(highlightedWordsRef.current),
            audioTime: audioTime,
            timestamp: new Date()
          }
          
          setSavedHighlights(prev => [...prev, newHighlight])
          updateHandStatus(`Saved: "${highlightedText.slice(0, 30)}${highlightedText.length > 30 ? '...' : ''}"`)
          
          return 'save_highlight'
        }
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
        
        // If palm is still, check for panel close, focus mode exit, or play
        if (!isMovingFast) {
          // Close saved highlights panel if open
          if (showSavedPanelRef.current && holdTime > 300) {
            setShowSavedPanel(false)
            
            // Resume audio if it was playing before panel opened
            if (wasPlayingBeforePanelRef.current) {
              const audio = audioElementRef.current
              if (audio) {
                audio.play().catch(err => console.error('Error resuming audio:', err))
              }
              wasPlayingBeforePanelRef.current = false
            }
            
            updateHandStatus('🖐 Closed highlights panel')
            resetVisualFeedback()
            return null
          }
          
          // Exit focus mode if in focus mode
          if (focusModeRef.current && holdTime > 500) {
            setFocusMode(false)
            
            // Resume audio if it was playing before focus mode
            if (wasPlayingBeforeFocusRef.current) {
              const audio = audioElementRef.current
              if (audio) {
                audio.play().catch(err => console.error('Error resuming audio:', err))
              }
              wasPlayingBeforeFocusRef.current = false
            }
            
            updateHandStatus('🖐 Exited focus mode')
            resetVisualFeedback()
            return null
          }
          
          // Otherwise, use for play (when paused)
          if (audio.paused && !focusModeRef.current) {
            const holdRequired = 600
            holdProgressRef.current = Math.min(1, holdTime / holdRequired)
            holdTypeRef.current = 'play'
            swipeProgressRef.current = 0
            swipeDirectionRef.current = null
            visualOpacityRef.current = 1 // Full opacity during hold
            
            if (holdTime > holdRequired && now - lastCutoffTimeRef.current > 1500) {
              audio.play()
              updateHandStatus('🖐 Palm → Playing!')
              lastCutoffTimeRef.current = now
              // Set fade-out time to show visual briefly after play (same as pause)
              visualFeedbackFadeOutTimeRef.current = now + 800 // Show for 800ms after play
              return 'play'
            }
            updateHandStatus(`🖐 Hold to play...`)
          } else if (!audio.paused && !focusModeRef.current) {
            // Audio is playing - show play icon if within fade-out window
            if (visualFeedbackFadeOutTimeRef.current && now < visualFeedbackFadeOutTimeRef.current) {
              holdTypeRef.current = 'play'
              holdProgressRef.current = 1 // Full circle
              // Calculate fade-out opacity
              const timeLeft = visualFeedbackFadeOutTimeRef.current - now
              visualOpacityRef.current = Math.min(1, timeLeft / 800) // Fade over 800ms
            } else {
              visualFeedbackFadeOutTimeRef.current = null
              visualOpacityRef.current = 1
              updateHandStatus('🖐 Palm - swipe to seek')
              resetVisualFeedback()
            }
          }
        }
        
        isSwipeInProgress = false
        return null
      }
      
      // 2. CLOSED FIST held STILL for 500ms = PAUSE (only when playing)
      if (pose === 'fist') {
        if (!audio.paused) {
          // Prevent pause if user was recently pointing (they're highlighting, not pausing)
          if (wasRecentlyPointing) {
            // User was just pointing - don't trigger pause, reset timer
            poseStartTime = now
            resetVisualFeedback()
            return null
          }
          
          // Only trigger if hand is relatively still
          if (!isMovingFast) {
            const holdRequired = 600
            holdProgressRef.current = Math.min(1, holdTime / holdRequired)
            holdTypeRef.current = 'pause'
            swipeProgressRef.current = 0
            swipeDirectionRef.current = null
            visualOpacityRef.current = 1 // Full opacity during hold
            
            if (holdTime > holdRequired && now - lastCutoffTimeRef.current > 1500) {
              audio.pause()
              updateHandStatus('✊ Fist → Paused!')
              lastCutoffTimeRef.current = now
              // Set fade-out time to show visual briefly after pause
              visualFeedbackFadeOutTimeRef.current = now + 800 // Show for 800ms after pause
              return 'pause'
            }
            updateHandStatus(`✊ Hold to pause...`)
          } else {
            // Moving too fast, reset timer
            poseStartTime = now
            resetVisualFeedback()
            updateHandStatus('✊ Hold still to pause')
          }
        } else {
          // Audio is paused - show pause icon if within fade-out window
          if (visualFeedbackFadeOutTimeRef.current && now < visualFeedbackFadeOutTimeRef.current) {
            holdTypeRef.current = 'pause'
            holdProgressRef.current = 1 // Full circle
            // Calculate fade-out opacity
            const timeLeft = visualFeedbackFadeOutTimeRef.current - now
            visualOpacityRef.current = Math.min(1, timeLeft / 800) // Fade over 800ms
          } else {
            visualFeedbackFadeOutTimeRef.current = null
            visualOpacityRef.current = 1
            resetVisualFeedback()
          }
        }
        return null
      }
      
      // Reset visual feedback for other poses (unless within fade-out window)
      if (!visualFeedbackFadeOutTimeRef.current || now >= visualFeedbackFadeOutTimeRef.current) {
        resetVisualFeedback()
        visualFeedbackFadeOutTimeRef.current = null
      }
      
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

    // Check if finger is hovering over the saved highlights button
    // Works with any hand pose (not just pointing) for easier access
    const checkHoverOnSavedButton = (handX: number, handY: number) => {
      const button = savedButtonRef.current
      if (!button) {
        console.log('Button ref not found')
        return false
      }
      
      const rect = button.getBoundingClientRect()
      const padding = 50 // Extra padding for easier targeting
      
      // Debug: log positions occasionally
      if (Math.random() < 0.05) {
        console.log('Button rect:', rect, 'Hand:', handX, handY)
      }
      
      if (
        handX >= rect.left - padding &&
        handX <= rect.right + padding &&
        handY >= rect.top - padding &&
        handY <= rect.bottom + padding
      ) {
        // Hovering over saved button - open panel and pause audio
        if (!showSavedPanelRef.current) {
          const audio = audioElementRef.current
          if (audio && !audio.paused) {
            wasPlayingBeforePanelRef.current = true
            audio.pause()
          } else {
            wasPlayingBeforePanelRef.current = false
          }
          setShowSavedPanel(true)
          updateHandStatus('Viewing saved highlights - palm to close')
        }
        return true
      }
      return false
    }
    
    // Check if hand is hovering over any word for highlighting (only when pointing)
    // Helper function to find consecutive highlighted words containing a given word index
    const findConsecutiveHighlightedGroup = (wordIndex: number): number[] => {
      const highlighted = highlightedWordsRef.current
      if (!highlighted.has(wordIndex)) return []
      
      const allIndices = Array.from(highlighted).sort((a, b) => a - b)
      const groups: number[][] = []
      let currentGroup: number[] = []
      
      for (let i = 0; i < allIndices.length; i++) {
        if (currentGroup.length === 0 || allIndices[i] === currentGroup[currentGroup.length - 1] + 1) {
          currentGroup.push(allIndices[i])
        } else {
          if (currentGroup.length > 0) {
            groups.push(currentGroup)
          }
          currentGroup = [allIndices[i]]
        }
      }
      if (currentGroup.length > 0) {
        groups.push(currentGroup)
      }
      
      // Find the group containing the wordIndex
      for (const group of groups) {
        if (group.includes(wordIndex)) {
          return group
        }
      }
      
      return [wordIndex] // Fallback: just the single word
    }
    
    // Find the closest word to the finger position
    const checkHandHoverOnWords = (handX: number, handY: number, isPointing: boolean) => {
      if (!isPointing) {
        isHoveringWordRef.current = false
        hoveredWordIndexRef.current = null
        gradientExpansionRef.current = { wordIndices: [], progress: 0 }
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
        const isAlreadyHighlighted = highlightedWordsRef.current.has(closestWord.index)
        const inFocusMode = focusModeRef.current
        
        if (hoveredWordIndexRef.current !== closestWord.index) {
          hoveredWordIndexRef.current = closestWord.index
          // Reset all hold timers when moving to a new word
          holdOnHighlightedStartTimeRef.current = null
          holdOnHighlightedWordRef.current = null
          holdToUnhighlightStartTimeRef.current = null
          holdToUnhighlightWordRef.current = null
          
          // Reset gradient expansion when moving to a new word
          // Only allow gradient expansion if word was ALREADY highlighted before we started hovering
          const wasAlreadyHighlighted = isAlreadyHighlighted
          if (wasAlreadyHighlighted && !inFocusMode) {
            // Word was already highlighted - find the entire group and allow gradient expansion
            const wordGroup = findConsecutiveHighlightedGroup(closestWord.index)
            gradientExpansionRef.current = { wordIndices: wordGroup, progress: 0 }
          } else {
            // Word was not highlighted - reset expansion (first hover)
            gradientExpansionRef.current = { wordIndices: [], progress: 0 }
          }
          
          // Auto-highlight on hover (shows as underline, not color change)
          if (!inFocusMode) {
            setHighlightedWords(prev => {
              if (prev.has(closestWord!.index)) return prev
              const newSet = new Set(prev)
              newSet.add(closestWord!.index)
              return newSet
            })
          }
        }
        
        // Track gradient expansion for already highlighted words (second hover)
        // Only expand if the word was already highlighted when we started hovering
        if (isAlreadyHighlighted && !inFocusMode && gradientExpansionRef.current.wordIndices.includes(closestWord.index)) {
          // Animate expansion progress (0 to 1)
          gradientExpansionRef.current.progress = Math.min(1, gradientExpansionRef.current.progress + 0.05)
        } else {
          // Reset expansion when not hovering over highlighted word
          if (gradientExpansionRef.current.wordIndices.includes(closestWord.index)) {
            gradientExpansionRef.current.progress = Math.max(0, gradientExpansionRef.current.progress - 0.1)
            if (gradientExpansionRef.current.progress <= 0) {
              gradientExpansionRef.current = { wordIndices: [], progress: 0 }
            }
          }
        }
        
        // In focus mode: allow unhighlighting by holding on highlighted text
        if (inFocusMode && isAlreadyHighlighted) {
          const now = Date.now()
          if (holdToUnhighlightWordRef.current !== closestWord.index) {
            holdToUnhighlightStartTimeRef.current = now
            holdToUnhighlightWordRef.current = closestWord.index
          } else if (holdToUnhighlightStartTimeRef.current) {
            const holdDuration = now - holdToUnhighlightStartTimeRef.current
            const holdRequired = 1000 // 1 second to unhighlight
            
            if (holdDuration >= holdRequired) {
              // Unhighlight this word
              setHighlightedWords(prev => {
                const newSet = new Set(prev)
                newSet.delete(closestWord!.index)
                
                // If no highlighted words left, exit focus mode
                if (newSet.size === 0) {
                  setFocusMode(false)
                  
                  // Resume audio if it was playing before focus mode
                  if (wasPlayingBeforeFocusRef.current) {
                    const audio = audioElementRef.current
                    if (audio) {
                      audio.play().catch(err => console.error('Error resuming audio:', err))
                    }
                    wasPlayingBeforeFocusRef.current = false
                  }
                  
                  updateHandStatus('All text unhighlighted - focus mode exited')
                } else {
                  updateHandStatus(`Unhighlighted word (${newSet.size} highlighted)`)
                }
                
                return newSet
              })
              holdToUnhighlightStartTimeRef.current = null
              holdToUnhighlightWordRef.current = null
            } else {
              const progress = Math.round((holdDuration / holdRequired) * 100)
              updateHandStatus(`Hold to unhighlight... ${progress}%`)
            }
          }
        }
        // In normal mode: hold on highlighted text to enter focus mode
        else if (!inFocusMode && isAlreadyHighlighted) {
          const now = Date.now()
          if (holdOnHighlightedWordRef.current !== closestWord.index) {
            holdOnHighlightedStartTimeRef.current = now
            holdOnHighlightedWordRef.current = closestWord.index
          } else if (holdOnHighlightedStartTimeRef.current) {
            const holdDuration = now - holdOnHighlightedStartTimeRef.current
            const holdRequired = 1500 // 1.5 seconds
            
            if (holdDuration >= holdRequired) {
              // Trigger focus mode!
              console.log('Focus mode triggered by hold gesture!')
              
              // Pause audio and remember if it was playing
              const audio = audioElementRef.current
              if (audio && !audio.paused) {
                wasPlayingBeforeFocusRef.current = true
                audio.pause()
              } else {
                wasPlayingBeforeFocusRef.current = false
              }
              
              setFocusMode(true)
              updateHandStatus('Focus mode: Showing highlighted text only')
              holdOnHighlightedStartTimeRef.current = null
              holdOnHighlightedWordRef.current = null
            } else {
              const progress = Math.round((holdDuration / holdRequired) * 100)
              updateHandStatus(`Hold on highlighted text... ${progress}%`)
            }
          }
        } else {
          // Reset timers when not on highlighted text
          holdOnHighlightedStartTimeRef.current = null
          holdOnHighlightedWordRef.current = null
          holdToUnhighlightStartTimeRef.current = null
          holdToUnhighlightWordRef.current = null
        }
      } else {
        isHoveringWordRef.current = false
        hoveredWordIndexRef.current = null
        gradientExpansionRef.current = { wordIndices: [], progress: 0 }
        holdOnHighlightedStartTimeRef.current = null
        holdOnHighlightedWordRef.current = null
        holdToUnhighlightStartTimeRef.current = null
        holdToUnhighlightWordRef.current = null
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
              // Use full camera range [0, 1] to screen range, no clamping
              // This allows the cursor to reach all parts of the screen
              const fingerX = (1 - indexTip.x) * screenWidth
              const fingerY = indexTip.y * screenHeight
              
              // Store finger position for visual indicator
              fingerPosRef.current = { x: fingerX, y: fingerY }
              currentPoseRef.current = gestureResult
              
              // Always check for button hover (works with any gesture)
              const isOverButton = checkHoverOnSavedButton(fingerX, fingerY)
              
              // Only check word hover when pointing and not over the button
              const isPointing = gestureResult === 'point'
              if (!isOverButton) {
                checkHandHoverOnWords(fingerX, fingerY, isPointing)
              }
            } else {
              handDetected = false
              handPos.x = -1
              handPos.y = -1
              
              // Sync to refs
              handPosRef.current = { x: -1, y: -1 }
              handDetectedRef.current = false
              isHoveringWordRef.current = false
              hoveredWordIndexRef.current = null
              gradientExpansionRef.current = { wordIndices: [], progress: 0 }
              
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
        
        // Set background color immediately
        p.background(213, 215, 206, 255) // rgba(213, 215, 206)
        
        // Set Montserrat font for particle text
        p.textFont('Montserrat')
        
        // Set up the hidden text container to match canvas
        setupTextContainer(p)

        setTimeout(() => {
          initializeHandTracking()
          initializeAudio()
        }, 100)

      }

      p.draw = () => {
        // Background color
        p.background(213, 215, 206, 255) // rgba(213, 215, 206)

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
        
        // Animate focus mode transition
        if (focusModeRef.current) {
          focusAnimationProgressRef.current = Math.min(1, focusAnimationProgressRef.current + 0.05)
        } else {
          focusAnimationProgressRef.current = Math.max(0, focusAnimationProgressRef.current - 0.05)
        }
        
        // Update particles with current scroll offset for hand interaction
        for (let particle of particles) {
          particle.update(p, currentScrollOffset)
        }

        // Draw particles with scroll offset, highlight state, and hover state
        const hoveredWordIndex = hoveredWordIndexRef.current
        const isHighlightModeOn = highlightModeRef.current
        const focusProgress = focusAnimationProgressRef.current
        const flyOff = flyOffAnimationRef.current
        
        // Update fly-off animation progress
        if (flyOff.active) {
          flyOff.progress += 0.04 // Animation speed
          
          // Animation complete
          if (flyOff.progress >= 1) {
            flyOff.active = false
            flyOff.progress = 0
            // Exit focus mode and clear highlights
            setFocusMode(false)
            setHighlightedWords(new Set())
            
            // Resume audio if it was playing before focus mode
            // Audio position is preserved automatically when pausing/playing
            const shouldResume = wasPlayingBeforeFocusRef.current
            wasPlayingBeforeFocusRef.current = false
            
            if (shouldResume) {
              // Use setTimeout to ensure state updates are complete before resuming
              setTimeout(() => {
                const audio = audioElementRef.current
                if (audio) {
                  // Ensure audio resumes from where it stopped
                  audio.play().then(() => {
                    console.log('Audio resumed after saving highlight')
                  }).catch(err => {
                    console.error('Error resuming audio after save:', err)
                  })
                }
              }, 50)
            }
            
            updateHandStatus('Highlight saved!')
          }
        }

        // Draw gradient fills for hovered highlighted words (before particles so they appear behind text)
        if (gradientExpansionRef.current.wordIndices.length > 0 && gradientExpansionRef.current.progress > 0) {
          const hoveredWordIndices = gradientExpansionRef.current.wordIndices
          const expansionProgress = gradientExpansionRef.current.progress
          
          // Find particles for all words in the group (including spaces between words)
          const groupParticles = particles.filter(p => 
            hoveredWordIndices.includes(p.wordIndex) &&
            (!flyOff.active || !flyOff.savedWordIndices.includes(p.wordIndex))
          )
          
          if (groupParticles.length > 0) {
            // Calculate bounding box for the entire group
            let leftX = Infinity
            let rightX = -Infinity
            let wordY = 0
            const textSize = groupParticles.find(p => p.char !== ' ')?.size || 54
            
            for (const part of groupParticles) {
              const drawY = part.y - currentScrollOffset
              const charWidth = part.size * 0.6
              leftX = Math.min(leftX, part.x - charWidth / 2)
              rightX = Math.max(rightX, part.x + charWidth / 2)
              if (wordY === 0 && part.char !== ' ') wordY = drawY // Use Y from first non-space particle
            }
            
            if (leftX !== Infinity && rightX !== -Infinity && wordY > 0) {
              const underlineY = wordY + textSize * 0.4
              // Calculate the full height from underline to top of text
              const textTop = wordY - textSize * 0.7  // Higher top to cover ascenders
              const fullHeight = underlineY - textTop  // Height from underline to top
              const fillHeight = fullHeight * expansionProgress
              const fillY = underlineY - fillHeight  // Start from underline and expand upward
              
              // Draw gradient fill - gradient goes from underline (bottom) to top
              const ctx = p.drawingContext as CanvasRenderingContext2D
              const fillGradient = ctx.createLinearGradient(leftX, underlineY, rightX, textTop)
              fillGradient.addColorStop(0, 'rgba(255, 107, 107, 1)') // Red at underline
              fillGradient.addColorStop(1, 'rgba(255, 165, 0, 1)')   // Orange at top
              
              ctx.fillStyle = fillGradient
              ctx.fillRect(leftX, fillY, rightX - leftX, fillHeight)
            }
          }
        }

        for (let particle of particles) {
          const isHighlighted = highlightedWordsRef.current.has(particle.wordIndex)
          const isFlying = flyOff.active && flyOff.savedWordIndices.includes(particle.wordIndex)
          
          // Fly-off animation for saved highlights
          if (isFlying) {
            // Calculate fly-off position
            const flyDistance = flyOff.progress * 2000 // Fly 2000px
            const flyX = particle.x + flyOff.direction.x * flyDistance
            const flyY = particle.y + flyOff.direction.y * flyDistance - currentScrollOffset
            
            // Ease out effect + scale up + fade
            const easeProgress = 1 - Math.pow(1 - flyOff.progress, 3)
            const scale = 1 + easeProgress * 0.5 // Scale up slightly
            const alpha = 1 - easeProgress
            
            // Draw flying particle
            p.push()
            p.translate(flyX, flyY)
            p.scale(scale)
            p.translate(-flyX, -flyY)
            
            // Draw with black color and fading (keep original color, don't change to amber)
            const ctx = p.drawingContext
            ctx.shadowBlur = 15 + easeProgress * 20
            ctx.shadowColor = `rgba(0, 0, 0, ${0.5 * alpha})`
            p.textSize(particle.size)
            p.textAlign(p.CENTER, p.CENTER)
            p.fill(0, 0, 0, 255 * alpha) // Keep black color, just fade out
            p.text(particle.char, flyX, flyY)
            ctx.shadowBlur = 0
            
            p.pop()
            continue // Skip normal drawing
          }
          
          // Check if this particle's word has gradient expansion active
          const hasGradientExpansion = gradientExpansionRef.current.wordIndices.includes(particle.wordIndex) && 
                                      gradientExpansionRef.current.progress > 0
          
          // In focus mode, fade out non-highlighted words
          if (focusProgress > 0) {
            if (!isHighlighted) {
              // Fade out non-highlighted words
              const alpha = 1 - focusProgress
              if (alpha <= 0) continue // Skip drawing if fully faded
              // Draw with white color if gradient expansion is active
              if (hasGradientExpansion) {
                particle.drawWithColor(p, currentScrollOffset, alpha, 255, 255, 255)
              } else {
                particle.draw(p, currentScrollOffset, alpha)
              }
            } else {
              // Highlighted words stay fully visible
              // Draw with white color if gradient expansion is active
              if (hasGradientExpansion) {
                particle.drawWithColor(p, currentScrollOffset, 1, 255, 255, 255)
              } else {
                particle.draw(p, currentScrollOffset, 1)
              }
            }
          } else {
            // Normal mode - draw all particles normally
            // Draw with white color if gradient expansion is active
            if (hasGradientExpansion) {
              particle.drawWithColor(p, currentScrollOffset, 1, 255, 255, 255)
            } else {
              particle.draw(p, currentScrollOffset, 1)
            }
          }
        }
        
        // Draw underlines for highlighted words and hovered words
        // Group consecutive highlighted words together for continuous underlines
        // Exclude words that are currently flying off screen
        const allHighlightedWords = Array.from(highlightedWordsRef.current)
          .filter(wordIndex => {
            // Don't draw underlines for words that are flying off
            if (flyOff.active && flyOff.savedWordIndices.includes(wordIndex)) {
              return false
            }
            return true
          })
          .sort((a, b) => a - b)
        const hoveredWord = hoveredWordIndex !== null && isHighlightModeOn && !highlightedWordsRef.current.has(hoveredWordIndex) 
          ? hoveredWordIndex 
          : null
        
        // Group consecutive highlighted words
        const groups: number[][] = []
        let currentGroup: number[] = []
        
        for (let i = 0; i < allHighlightedWords.length; i++) {
          const wordIndex = allHighlightedWords[i]
          const prevIndex = i > 0 ? allHighlightedWords[i - 1] : -1
          
          // If this word is consecutive with the previous, add to current group
          if (wordIndex === prevIndex + 1) {
            currentGroup.push(wordIndex)
          } else {
            // Start a new group
            if (currentGroup.length > 0) {
              groups.push(currentGroup)
            }
            currentGroup = [wordIndex]
          }
        }
        if (currentGroup.length > 0) {
          groups.push(currentGroup)
        }
        
        // Draw continuous underline for each group of consecutive words
        for (const group of groups) {
          const firstWordIndex = group[0]
          const lastWordIndex = group[group.length - 1]
          
          // Find all particles from first word to last word (including spaces)
          // This includes the space after each word (which has the same wordIndex)
          let leftX = Infinity
          let rightX = -Infinity
          let wordY = 0
          
          // Get all particles in the range, including spaces
          // Exclude particles that are flying off screen
          for (const part of particles) {
            // Skip particles that are flying off
            if (flyOff.active && flyOff.savedWordIndices.includes(part.wordIndex)) {
              continue
            }
            // Include particles from first word through last word
            // Also include spaces that come after words in the group
            if (part.wordIndex >= firstWordIndex && part.wordIndex <= lastWordIndex) {
              const drawY = part.y - currentScrollOffset
              const charWidth = part.size * 0.6 // Approximate character width
              leftX = Math.min(leftX, part.x - charWidth / 2)
              rightX = Math.max(rightX, part.x + charWidth / 2)
              if (wordY === 0) wordY = drawY // Use Y from first particle
            }
          }
          
          // Draw continuous underline spanning all words in group with red-to-orange gradient
          // Skip drawing underline if gradient expansion is active (gradient replaces it)
          const isHoveredWithExpansion = group.some(wordIdx => 
            gradientExpansionRef.current.wordIndices.includes(wordIdx) && 
            gradientExpansionRef.current.progress > 0
          )
          
          if (leftX !== Infinity && rightX !== -Infinity && !isHoveredWithExpansion) {
            const firstWordParticle = particles.find(p => p.wordIndex === firstWordIndex && p.char !== ' ')
            const textSize = firstWordParticle?.size || 54
            const underlineY = wordY + textSize * 0.4
            const underlineThickness = 3
            
            // Create red-to-orange gradient for underline (similar to CSS linear-gradient)
            const ctx = p.drawingContext as CanvasRenderingContext2D
            const gradient = ctx.createLinearGradient(leftX, underlineY, rightX, underlineY)
            // Red to orange gradient: #ff6b6b (red) to #ffa500 (orange)
            gradient.addColorStop(0, 'rgba(255, 107, 107, 1)') // Red
            gradient.addColorStop(1, 'rgba(255, 165, 0, 1)')   // Orange
            
            ctx.strokeStyle = gradient
            ctx.lineWidth = underlineThickness
            ctx.beginPath()
            ctx.moveTo(leftX, underlineY)
            ctx.lineTo(rightX, underlineY)
            ctx.stroke()
          }
        }
        
        // Draw separate underline for hovered word if not highlighted
        // Don't draw if the word is flying off screen
        if (hoveredWord !== null && (!flyOff.active || !flyOff.savedWordIndices.includes(hoveredWord))) {
          const hoveredParticles = particles.filter(p => 
            p.wordIndex === hoveredWord && 
            p.char !== ' ' &&
            (!flyOff.active || !flyOff.savedWordIndices.includes(p.wordIndex))
          )
          if (hoveredParticles.length > 0) {
            let leftX = Infinity
            let rightX = -Infinity
            let wordY = 0
            
            for (const part of hoveredParticles) {
              const drawY = part.y - currentScrollOffset
              const charWidth = part.size * 0.6
              leftX = Math.min(leftX, part.x - charWidth / 2)
              rightX = Math.max(rightX, part.x + charWidth / 2)
              wordY = drawY
            }
            
            const underlineY = wordY + (hoveredParticles[0].size * 0.4)
            // Create red-to-orange gradient for hover (lighter opacity)
            const ctx = p.drawingContext as CanvasRenderingContext2D
            const gradient = ctx.createLinearGradient(leftX, underlineY, rightX, underlineY)
            // Red to orange gradient with reduced opacity for hover
            gradient.addColorStop(0, 'rgba(255, 107, 107, 0.78)') // Red with ~78% opacity
            gradient.addColorStop(1, 'rgba(255, 165, 0, 0.78)')   // Orange with ~78% opacity
            
            ctx.strokeStyle = gradient
            ctx.lineWidth = 2
            ctx.beginPath()
            ctx.moveTo(leftX, underlineY)
            ctx.lineTo(rightX, underlineY)
            ctx.stroke()
          }
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
          
          // 1. POINTING - Clean, refined cursor
          if (fingerPos.x >= 0 && fingerPos.y >= 0) {
            const isPointingPose = currentPose === 'point'
            const opacity = isPointingPose ? 1 : 0.25 // Subtle when not pointing
            
            // Simple, clean ring
            p.noFill()
            p.stroke(0, 0, 0, 200 * opacity)
            p.strokeWeight(1.5)
            p.circle(fingerPos.x, fingerPos.y, 20)
            
            // Clean center dot
            p.fill(0, 0, 0, 255 * opacity)
            p.noStroke()
            p.circle(fingerPos.x, fingerPos.y, 3)
          }
          
          // 2. HOLD GESTURE - Static centered ring (sleek minimal design)
          if (holdProgress > 0 && holdType) {
            const ringRadius = 50
            const ringX = screenCenterX
            const ringY = screenCenterY
            const isPlay = holdType === 'play'
            
            // Use opacity from ref (updated in gesture handler)
            const visualOpacity = visualOpacityRef.current
            
            // Subtle shadow/glow effect
            p.drawingContext.shadowBlur = 20
            p.drawingContext.shadowColor = `rgba(0, 0, 0, ${0.1 * visualOpacity})`
            
            // Background ring track (very subtle)
            p.noFill()
            p.stroke(200, 200, 200, 100 * visualOpacity)
            p.strokeWeight(2)
            p.circle(ringX, ringY, ringRadius * 2)
            
            // Main progress arc (elegant thin line)
            const startAngle = -p.HALF_PI
            const endAngle = startAngle + (holdProgress * p.TWO_PI)
            p.stroke(50, 50, 50, 200 * visualOpacity)
            p.strokeWeight(3)
            p.strokeCap(p.ROUND)
            p.arc(ringX, ringY, ringRadius * 2, ringRadius * 2, startAngle, endAngle)
            
            // Reset shadow
            p.drawingContext.shadowBlur = 0
            
            // Icon in center (minimal)
            p.fill(60, 60, 60, 220 * visualOpacity)
            p.noStroke()
            if (isPlay) {
              // Play triangle (smaller, more refined)
              const triSize = 16
              p.triangle(
                ringX - triSize * 0.3, ringY - triSize * 0.8,
                ringX - triSize * 0.3, ringY + triSize * 0.8,
                ringX + triSize * 0.9, ringY
              )
            } else {
              // Pause bars (thinner, more elegant)
              const barW = 4
              const barH = 20
              const barGap = 6
              p.rect(ringX - barW - barGap / 2, ringY - barH / 2, barW, barH, 2)
              p.rect(ringX + barGap / 2, ringY - barH / 2, barW, barH, 2)
            }
          }
          
          // 3. SWIPE - Centered indicator (sleek minimal design)
          if (swipeProgress > 0 && swipeDirection) {
            const ringRadius = 50
            const ringX = screenCenterX
            const ringY = screenCenterY
            const isRight = swipeDirection === 'right'
            
            // Subtle shadow/glow effect
            p.drawingContext.shadowBlur = 20
            p.drawingContext.shadowColor = 'rgba(0, 0, 0, 0.1)'
            
            // Background ring track (very subtle)
            p.noFill()
            p.stroke(200, 200, 200, 100)
            p.strokeWeight(2)
            p.circle(ringX, ringY, ringRadius * 2)
            
            // Main progress arc (elegant thin line)
            const startAngle = -p.HALF_PI
            const endAngle = startAngle + (swipeProgress * p.TWO_PI)
            p.stroke(50, 50, 50, 200)
            p.strokeWeight(3)
            p.strokeCap(p.ROUND)
            p.arc(ringX, ringY, ringRadius * 2, ringRadius * 2, startAngle, endAngle)
            
            // Reset shadow
            p.drawingContext.shadowBlur = 0
            
            // Arrow icon in center (minimal, single arrow)
            p.fill(60, 60, 60, 220)
            p.noStroke()
            
            const arrowSize = 18
            if (isRight) {
              // Right arrow (forward) - single elegant arrow
              p.beginShape()
              p.vertex(ringX - arrowSize * 0.2, ringY - arrowSize * 0.7)
              p.vertex(ringX + arrowSize * 0.8, ringY)
              p.vertex(ringX - arrowSize * 0.2, ringY + arrowSize * 0.7)
              p.vertex(ringX, ringY)
              p.endShape(p.CLOSE)
            } else {
              // Left arrow (backward) - single elegant arrow
              p.beginShape()
              p.vertex(ringX + arrowSize * 0.2, ringY - arrowSize * 0.7)
              p.vertex(ringX - arrowSize * 0.8, ringY)
              p.vertex(ringX + arrowSize * 0.2, ringY + arrowSize * 0.7)
              p.vertex(ringX, ringY)
              p.endShape(p.CLOSE)
            }
          }
          
          p.pop()
        }
      }

      p.keyPressed = () => {
        if (p.key === 'Escape' || p.key === 'Esc') {
          if (focusModeRef.current) {
            setFocusMode(false)
            
            // Resume audio if it was playing before focus mode
            if (wasPlayingBeforeFocusRef.current) {
              const audio = audioElementRef.current
              if (audio) {
                audio.play().catch(err => console.error('Error resuming audio:', err))
              }
              wasPlayingBeforeFocusRef.current = false
            }
            
            updateHandStatus('Focus mode: Exited')
          }
        }
        if (p.key === 'f' || p.key === 'F') {
          // Test focus mode toggle
          if (highlightedWordsRef.current.size > 0) {
            setFocusMode(!focusModeRef.current)
            updateHandStatus(focusModeRef.current ? 'Focus mode: OFF' : 'Focus mode: ON')
          } else {
            updateHandStatus('Highlight some text first (point at words)')
          }
        }
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
    <div className="text-mode-container highlight-mode">
      {/* Header bar */}
      <header className={`app-header ${isAudioPlaying ? 'header-hidden' : ''}`}>
        <div className="header-content">
          <h1 className="app-title">wordplay</h1>
          <nav className="header-nav">
            <button className="mode-button"><span>text mode</span></button>
            <button className="mode-button"><span>play mode</span></button>
          </nav>
        </div>
      </header>
      
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
        <span><span className="material-symbols-outlined gesture-icon">front_hand</span> Palm (hold still): Play</span>
        <span><span className="material-symbols-outlined gesture-icon">swipe_left</span><span className="material-symbols-outlined gesture-icon">swipe_right</span> Palm (swipe): Seek</span>
        <span><img src="/noun-fist-8177248.png" alt="Fist" className="gesture-icon" style={{width: '18px', height: '18px'}} /> Fist (hold still): Pause</span>
        <span><span className="material-symbols-outlined gesture-icon">touch_app</span> Point: Highlight text</span>
        <span><span className="material-symbols-outlined gesture-icon">swipe_up</span> Diagonal swipe: Save</span>
      </div>
      
      {/* Saved highlights button */}
      <button 
        ref={savedButtonRef}
        className="saved-highlights-button"
        onClick={() => {
          if (!showSavedPanelRef.current) {
            // Opening panel - pause audio if playing
            const audio = audioElementRef.current
            if (audio && !audio.paused) {
              wasPlayingBeforePanelRef.current = true
              audio.pause()
            } else {
              wasPlayingBeforePanelRef.current = false
            }
            setShowSavedPanel(true)
          } else {
            // Closing panel - resume audio if it was playing
            if (wasPlayingBeforePanelRef.current) {
              const audio = audioElementRef.current
              if (audio) {
                audio.play().catch(err => console.error('Error resuming audio:', err))
              }
              wasPlayingBeforePanelRef.current = false
            }
            setShowSavedPanel(false)
          }
        }}
      >
        ★ {savedHighlights.length}
      </button>
      
      {/* Saved highlights panel */}
      {showSavedPanel && (
        <div className="saved-highlights-panel">
          <div className="saved-highlights-header">
            <h3>Saved Highlights</h3>
            <button onClick={() => setShowSavedPanel(false)}>×</button>
          </div>
          <div className="saved-highlights-list">
            {savedHighlights.length === 0 ? (
              <div className="no-highlights">
                No saved highlights yet.<br/>
                <small>In focus mode, swipe diagonally to save highlighted text.</small>
              </div>
            ) : (
              savedHighlights.map((highlight) => (
                <div key={highlight.id} className="saved-highlight-item">
                  <div className="highlight-text">"{highlight.text}"</div>
                  <div className="highlight-meta">
                    <span className="highlight-time">
                      {Math.floor(highlight.audioTime / 60)}:{String(Math.floor(highlight.audioTime % 60)).padStart(2, '0')}
                    </span>
                    <span className="highlight-date">
                      {highlight.timestamp.toLocaleDateString()}
                    </span>
                    <button 
                      className="highlight-delete"
                      onClick={() => {
                        setSavedHighlights(prev => prev.filter(h => h.id !== highlight.id))
                      }}
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          {savedHighlights.length > 0 && (
            <button 
              className="clear-all-button"
              onClick={() => {
                if (window.confirm('Clear all saved highlights?')) {
                  setSavedHighlights([])
                  localStorage.removeItem('wordplay_highlights')
                }
              }}
            >
              Clear All
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default TextMode

