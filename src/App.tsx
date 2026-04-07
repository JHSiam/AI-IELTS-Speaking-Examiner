import React, { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Send, User, Bot, Loader2, Award, CheckCircle2, RefreshCw, Mic, MicOff, Volume2, VolumeX, Timer as TimerIcon } from "lucide-react";
import { getExaminerResponse } from "./lib/api";
import { cn } from "./lib/utils";
import ReactMarkdown from "react-markdown";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface Evaluation {
  criteria: { name: string; score: number; justification: string }[];
  overallScore: number;
  improvementTips: string[];
}

// Speech Recognition Types
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
  isFinal: boolean;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: (event: SpeechRecognitionEvent) => void;
  onerror: (event: any) => void;
  onend: () => void;
}

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [testStarted, setTestStarted] = useState(false);
  const [testFinished, setTestFinished] = useState(false);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [timer, setTimer] = useState<number | null>(null);
  const [isTimerActive, setIsTimerActive] = useState(false);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Initialize Speech Recognition
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let interimTranscript = "";
        let finalTranscript = "";

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }
        setTranscript(finalTranscript || interimTranscript);
      };

      recognition.onerror = (event: any) => {
        console.error("Speech recognition error:", event.error);
        setIsRecording(false);
      };

      recognition.onend = () => {
        setIsRecording(false);
      };

      recognitionRef.current = recognition;
    }
  }, []);

  // Timer logic
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isTimerActive && timer !== null && timer > 0) {
      interval = setInterval(() => {
        setTimer((prev) => (prev !== null ? prev - 1 : null));
      }, 1000);
    } else if (timer === 0) {
      setIsTimerActive(false);
      setTimer(null);
      // Automatically trigger a message from examiner after timer ends
      const endTimerMsg = "Your one minute preparation time is up. Please start speaking now. You have one to two minutes.";
      playExaminerVoice(endTimerMsg);
    }
    return () => clearInterval(interval);
  }, [isTimerActive, timer]);

  const playExaminerVoice = (text: string) => {
    // Cancel any ongoing speech
    window.speechSynthesis.cancel();

    // Clean text for speech (remove markdown)
    const cleanText = text
      .replace(/[*#_~`]/g, "")
      .replace(/\n+/g, " ")
      .trim();

    const utterance = new SpeechSynthesisUtterance(cleanText);
    
    // Try to find a good English voice
    const voices = window.speechSynthesis.getVoices();
    const englishVoice = voices.find(v => v.lang.startsWith('en') && v.name.includes('Google')) || 
                        voices.find(v => v.lang.startsWith('en')) || 
                        voices[0];
    
    if (englishVoice) {
      utterance.voice = englishVoice;
    }
    
    utterance.rate = 0.9; // Slightly slower for clarity
    utterance.pitch = 1.0;

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => {
      setIsSpeaking(false);
      // Check if we need to start timer after speech
      if (text.toLowerCase().includes("your time starts now")) {
        setTimer(60);
        setIsTimerActive(true);
      }
    };
    utterance.onerror = () => setIsSpeaking(false);

    window.speechSynthesis.speak(utterance);
  };

  const startTest = async () => {
    setTestStarted(true);
    setIsLoading(true);
    const initialMessage = "Hello, my name is Examiner James. I will be your examiner today. Can you tell me your full name?";
    setMessages([{ role: "assistant", content: initialMessage }]);
    setIsLoading(false);
    playExaminerVoice(initialMessage);
  };

  const toggleRecording = () => {
    if (isRecording) {
      recognitionRef.current?.stop();
      if (transcript.trim()) {
        handleSend(transcript.trim());
      }
    } else {
      setTranscript("");
      recognitionRef.current?.start();
      setIsRecording(true);
    }
  };

  const handleSend = async (userText: string) => {
    if (!userText || isLoading) return;

    const newMessages = [...messages, { role: "user", content: userText } as Message];
    setMessages(newMessages);
    setIsLoading(true);
    setTranscript("");

    try {
      const response = await getExaminerResponse(newMessages);
      setMessages([...newMessages, { role: "assistant", content: response } as Message]);
      
      playExaminerVoice(response);

      if (response.toLowerCase().includes("that is the end of the speaking test")) {
        setTestFinished(true);
        evaluateTest([...newMessages, { role: "assistant", content: response } as Message]);
      }
    } catch (error) {
      console.error("Error getting examiner response:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const evaluateTest = async (transcriptMessages: Message[]) => {
    setIsEvaluating(true);
    const transcriptText = transcriptMessages
      .map((m) => `${m.role === "assistant" ? "Examiner" : "Candidate"}: ${m.content}`)
      .join("\n\n");

    try {
      const response = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: transcriptText }),
      });
      const data = await response.json();
      setEvaluation(data);
    } catch (error) {
      console.error("Evaluation error:", error);
    } finally {
      setIsEvaluating(false);
    }
  };

  const resetTest = () => {
    setMessages([]);
    setTestStarted(false);
    setTestFinished(false);
    setEvaluation(null);
    setTimer(null);
    setIsTimerActive(false);
  };

  if (!testStarted) {
    return (
      <div className="min-h-screen bg-bg-warm flex items-center justify-center p-4 font-sans atmosphere relative overflow-hidden">
        {/* Decorative elements */}
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-brand-primary/5 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-brand-secondary/5 rounded-full blur-3xl animate-pulse delay-1000" />
        
        <motion.div 
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="max-w-2xl w-full bg-white/80 backdrop-blur-xl rounded-[2.5rem] shadow-2xl overflow-hidden border border-white/40 z-10"
        >
          <div className="p-10 md:p-16 text-center">
            <motion.div 
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.3, type: "spring" }}
              className="w-24 h-24 bg-gradient-to-br from-brand-primary to-brand-secondary rounded-3xl flex items-center justify-center mx-auto mb-10 shadow-2xl rotate-3"
            >
              <Award className="w-12 h-12 text-white" />
            </motion.div>
            
            <h1 className="text-5xl font-serif font-medium text-[#1a1a1a] mb-6 tracking-tight">
              IELTS <span className="text-brand-primary italic">Speaking</span> Examiner
            </h1>
            
            <p className="text-[#5A5A40] text-xl mb-12 leading-relaxed max-w-lg mx-auto font-light">
              Master your speaking skills with our professional AI simulation. 
              Real-time voice interaction and official band score analysis.
            </p>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
              {[
                { title: "Voice Only", desc: "Natural interaction", icon: Mic },
                { title: "AI Examiner", desc: "Expert guidance", icon: Bot },
                { title: "Score Report", desc: "Detailed feedback", icon: Award }
              ].map((item, i) => (
                <motion.div 
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 + (i * 0.1) }}
                  className="p-5 bg-white/50 rounded-2xl border border-brand-primary/5 hover:border-brand-primary/20 transition-colors group"
                >
                  <item.icon className="w-6 h-6 text-brand-primary mb-3 mx-auto group-hover:scale-110 transition-transform" />
                  <span className="block font-bold text-[#1a1a1a] mb-1 text-sm uppercase tracking-wider">{item.title}</span>
                  <span className="text-xs text-[#5A5A40]/70">{item.desc}</span>
                </motion.div>
              ))}
            </div>
            
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={startTest}
              className="w-full md:w-auto px-16 py-5 bg-brand-primary text-white rounded-full font-medium hover:bg-brand-primary/90 transition-all shadow-xl hover:shadow-brand-primary/20 text-lg"
            >
              Begin Official Simulation
            </motion.button>
          </div>
          
          <div className="bg-brand-primary/5 p-5 text-center text-xs text-brand-primary/60 border-t border-brand-primary/10 font-medium tracking-widest uppercase">
            Official Exam Standards • Real-time AI Evaluation • Band Score 0-9
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-warm flex flex-col font-sans atmosphere relative">
      {/* Header */}
      <header className="glass sticky top-0 z-30 px-6 py-5 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-4">
          <motion.div 
            whileHover={{ rotate: 10 }}
            className="w-12 h-12 bg-gradient-to-br from-brand-primary to-brand-secondary rounded-2xl flex items-center justify-center shadow-lg"
          >
            <Award className="w-7 h-7 text-white" />
          </motion.div>
          <div>
            <h2 className="font-serif font-medium text-xl text-[#1a1a1a]">IELTS Simulation</h2>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              <p className="text-xs text-brand-primary/60 font-medium uppercase tracking-wider">Examiner James • Active</p>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-5">
          <AnimatePresence>
            {timer !== null && (
              <motion.div 
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="flex items-center gap-3 px-5 py-2.5 bg-red-50 text-red-600 rounded-full font-mono font-bold border border-red-100 shadow-sm"
              >
                <TimerIcon className="w-5 h-5 animate-pulse" />
                <span className="text-lg">{Math.floor(timer / 60)}:{(timer % 60).toString().padStart(2, "0")}</span>
              </motion.div>
            )}
          </AnimatePresence>
          <button 
            onClick={resetTest}
            className="p-3 hover:bg-brand-primary/10 rounded-full transition-all text-brand-primary group"
            title="Reset Test"
          >
            <RefreshCw className="w-6 h-6 group-hover:rotate-180 transition-transform duration-500" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-5xl w-full mx-auto p-4 md:p-8 flex flex-col overflow-hidden relative z-10">
        <div 
          ref={scrollRef}
          className="flex-1 overflow-y-auto space-y-8 pr-4 scroll-smooth pb-10"
        >
          <AnimatePresence initial={false}>
            {messages.map((message, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                className={cn(
                  "flex gap-5 max-w-[80%]",
                  message.role === "user" ? "ml-auto flex-row-reverse" : "mr-auto"
                )}
              >
                <div className={cn(
                  "w-12 h-12 rounded-2xl flex-shrink-0 flex items-center justify-center shadow-md transition-transform hover:scale-110",
                  message.role === "assistant" 
                    ? "bg-white border border-brand-primary/10 text-brand-primary" 
                    : "bg-brand-primary text-white"
                )}>
                  {message.role === "assistant" ? <Bot className="w-6 h-6" /> : <User className="w-6 h-6" />}
                </div>
                <div className={cn(
                  "p-6 rounded-[2rem] shadow-sm leading-relaxed relative",
                  message.role === "assistant" 
                    ? "bg-white border border-brand-primary/10 text-[#1a1a1a] rounded-tl-none" 
                    : "bg-brand-primary text-white rounded-tr-none shadow-brand-primary/20"
                )}>
                  <div className="prose prose-sm max-w-none prose-p:leading-relaxed prose-headings:font-serif prose-headings:text-brand-primary">
                    <ReactMarkdown>
                      {message.content}
                    </ReactMarkdown>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          
          {isLoading && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex gap-5 mr-auto"
            >
              <div className="w-12 h-12 rounded-2xl bg-white border border-brand-primary/10 flex items-center justify-center shadow-md">
                <Bot className="w-6 h-6 text-brand-primary" />
              </div>
              <div className="p-6 rounded-[2rem] rounded-tl-none bg-white border border-brand-primary/10 flex items-center gap-3 shadow-sm">
                <div className="flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <motion.div
                      key={i}
                      animate={{ y: [0, -5, 0] }}
                      transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.1 }}
                      className="w-1.5 h-1.5 bg-brand-primary rounded-full"
                    />
                  ))}
                </div>
                <span className="text-sm text-brand-primary/60 font-medium italic">Examiner is considering...</span>
              </div>
            </motion.div>
          )}
          
          {isSpeaking && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex justify-center sticky bottom-0 z-20"
            >
              <div className="flex items-center gap-3 px-6 py-3 glass-dark text-brand-primary rounded-full text-sm font-bold shadow-xl border border-brand-primary/20">
                <div className="flex items-center gap-1">
                  {[...Array(4)].map((_, i) => (
                    <motion.div
                      key={i}
                      animate={{ height: [8, 16, 8] }}
                      transition={{ duration: 0.5, repeat: Infinity, delay: i * 0.1 }}
                      className="w-1 bg-brand-primary rounded-full"
                    />
                  ))}
                </div>
                <span>Examiner is speaking</span>
              </div>
            </motion.div>
          )}
        </div>

        {/* Voice Input Area */}
        {!testFinished && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-auto pt-8 flex flex-col items-center gap-6"
          >
            <AnimatePresence>
              {isRecording && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="w-full max-w-2xl glass p-6 rounded-3xl border border-brand-primary/10 text-center text-lg text-brand-primary font-light italic shadow-2xl"
                >
                  {transcript || "Listening to your response..."}
                </motion.div>
              )}
            </AnimatePresence>
            
            <div className="relative group">
              <div className={cn(
                "absolute inset-0 rounded-full blur-2xl transition-all duration-500",
                isRecording ? "bg-red-500/30 scale-150" : "bg-brand-primary/20 scale-110 group-hover:scale-125"
              )} />
              
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={toggleRecording}
                disabled={isLoading || isSpeaking || isTimerActive}
                className={cn(
                  "w-24 h-24 rounded-full flex items-center justify-center transition-all shadow-2xl z-10 relative",
                  isRecording 
                    ? "bg-red-500 text-white" 
                    : "bg-brand-primary text-white hover:bg-brand-primary/90",
                  (isLoading || isSpeaking || isTimerActive) && "opacity-50 cursor-not-allowed grayscale"
                )}
              >
                {isRecording ? <MicOff className="w-10 h-10" /> : <Mic className="w-10 h-10" />}
              </motion.button>
            </div>
            
            <p className="text-sm text-brand-primary/60 font-bold uppercase tracking-[0.2em]">
              {isRecording ? "Tap to finish speaking" : "Tap to respond"}
            </p>
          </motion.div>
        )}

        {/* Evaluation Modal */}
        <AnimatePresence>
          {testFinished && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-brand-primary/20 backdrop-blur-xl flex items-center justify-center p-4 overflow-y-auto"
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0, y: 50 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                transition={{ type: "spring", damping: 25 }}
                className="bg-white rounded-[3rem] shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col border border-white/50"
              >
                <div className="bg-gradient-to-r from-brand-primary to-brand-secondary p-8 md:p-12 text-white flex flex-col md:flex-row items-center justify-between gap-8">
                  <div className="flex items-center gap-6">
                    <div className="w-20 h-20 bg-white/20 backdrop-blur-md rounded-3xl flex items-center justify-center shadow-inner">
                      <Award className="w-10 h-10" />
                    </div>
                    <div>
                      <h2 className="text-4xl font-serif font-medium mb-2">Performance Report</h2>
                      <p className="text-white/70 font-medium tracking-widest uppercase text-xs">Official IELTS Standards Evaluation</p>
                    </div>
                  </div>
                  
                  {evaluation && (
                    <div className="bg-white/10 backdrop-blur-md px-10 py-6 rounded-[2rem] border border-white/20 text-center shadow-xl">
                      <div className="text-6xl font-bold mb-1">{evaluation.overallScore}</div>
                      <div className="text-[10px] uppercase tracking-[0.3em] font-bold opacity-80">Overall Band</div>
                    </div>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto p-8 md:p-12 space-y-12">
                  {isEvaluating ? (
                    <div className="flex flex-col items-center justify-center py-24 space-y-6">
                      <div className="relative">
                        <Loader2 className="w-20 h-20 animate-spin text-brand-primary opacity-20" />
                        <Bot className="w-10 h-10 text-brand-primary absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                      </div>
                      <div className="text-center">
                        <p className="text-2xl font-serif text-brand-primary mb-2">Generating Expert Analysis</p>
                        <p className="text-brand-primary/60 font-medium">Reviewing your fluency, vocabulary, and grammar...</p>
                      </div>
                    </div>
                  ) : evaluation ? (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {evaluation.criteria.map((c, i) => (
                          <motion.div 
                            key={i}
                            initial={{ opacity: 0, x: i % 2 === 0 ? -20 : 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: i * 0.1 }}
                            className="p-8 bg-bg-warm rounded-[2.5rem] border border-brand-primary/5 hover:shadow-lg transition-all group"
                          >
                            <div className="flex justify-between items-start mb-6">
                              <h3 className="font-bold text-brand-primary text-xs uppercase tracking-[0.2em]">{c.name}</h3>
                              <span className="w-12 h-12 bg-brand-primary text-white rounded-2xl flex items-center justify-center text-xl font-bold shadow-lg shadow-brand-primary/20 group-hover:scale-110 transition-transform">
                                {c.score}
                              </span>
                            </div>
                            <p className="text-[#5A5A40] leading-relaxed font-light">{c.justification}</p>
                          </motion.div>
                        ))}
                      </div>

                      <div className="space-y-6">
                        <h3 className="text-2xl font-serif font-medium text-brand-primary flex items-center gap-3">
                          <CheckCircle2 className="w-7 h-7" />
                          Strategic Improvement Tips
                        </h3>
                        <div className="grid grid-cols-1 gap-4">
                          {evaluation.improvementTips.map((tip, i) => (
                            <motion.div 
                              key={i}
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: 0.5 + (i * 0.1) }}
                              className="flex gap-5 text-[#5A5A40] bg-white p-6 rounded-[2rem] border border-brand-primary/10 hover:border-brand-primary/30 transition-colors shadow-sm"
                            >
                              <span className="w-10 h-10 bg-brand-primary/10 text-brand-primary rounded-2xl flex-shrink-0 flex items-center justify-center font-bold text-lg">
                                {i + 1}
                              </span>
                              <p className="font-light leading-relaxed">{tip}</p>
                            </motion.div>
                          ))}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-16">
                      <p className="text-red-500 text-xl font-medium mb-4">Evaluation Service Unavailable</p>
                      <button onClick={() => evaluateTest(messages)} className="text-brand-primary font-bold underline">Retry Analysis</button>
                    </div>
                  )}
                </div>

                <div className="p-8 bg-bg-warm border-t border-brand-primary/10 flex gap-6">
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={resetTest}
                    className="flex-1 py-5 bg-brand-primary text-white rounded-full font-bold hover:bg-brand-primary/90 transition-all shadow-xl shadow-brand-primary/20 text-lg uppercase tracking-widest"
                  >
                    Start New Simulation
                  </motion.button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
