"use client";

import { useState, useRef } from "react";

/**
 * AiCoachPanel — prompt generator + paste-back AI coaching panel.
 *
 * Flow:
 *   1. User clicks a preset prompt or types a custom question
 *   2. Panel builds a full prompt with context + data + question
 *   3. User copies the prompt to their chatbot (ChatGPT, Claude, etc.)
 *   4. User pastes the AI response back
 *   5. Panel displays the formatted response
 *
 * Props:
 *   context: string — page context description (e.g. "Sprint Burndown Chart")
 *   data: object — current page data to include in the prompt
 *   prompts: [{ label, question }] — preset prompt buttons
 *   title?: string — panel title (default "AI Coach")
 */
export default function AiCoachPanel({ context, data, prompts = [], title = "AI Coach", defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const [generatedPrompt, setGeneratedPrompt] = useState("");
  const [pastedResponse, setPastedResponse] = useState("");
  const [displayedResponse, setDisplayedResponse] = useState("");
  const [activePrompt, setActivePrompt] = useState(null);
  const [customQ, setCustomQ] = useState("");
  const [copied, setCopied] = useState(false);
  const [step, setStep] = useState("idle"); // idle | prompt | response
  const promptRef = useRef(null);

  function buildPrompt(question) {
    const dataStr = data ? JSON.stringify(data, null, 2).substring(0, 8000) : "No data available";

    return `You are an experienced Agile Coach and Scrum Master. You help teams improve their agile practices, identify process issues, and suggest actionable improvements.

CONTEXT: ${context}

DATA:
${dataStr}

USER QUESTION: ${question}

Provide a helpful, actionable response. Be specific and reference the data when possible. Keep your response concise but thorough. Use bullet points for recommendations. If suggesting process changes, explain the "why" behind each suggestion.`;
  }

  function handleSelectPrompt(question, label) {
    const prompt = buildPrompt(question);
    setGeneratedPrompt(prompt);
    setActivePrompt(label || question);
    setPastedResponse("");
    setDisplayedResponse("");
    setCopied(false);
    setStep("prompt");
  }

  function handleCustomSubmit(e) {
    e.preventDefault();
    if (!customQ.trim()) return;
    handleSelectPrompt(customQ.trim(), "Custom");
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(generatedPrompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      if (promptRef.current) {
        promptRef.current.select();
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    }
  }

  function handleApplyResponse() {
    if (!pastedResponse.trim()) return;
    setDisplayedResponse(pastedResponse.trim());
    setStep("response");
  }

  function handleReset() {
    setStep("idle");
    setGeneratedPrompt("");
    setPastedResponse("");
    setDisplayedResponse("");
    setActivePrompt(null);
  }

  return (
    <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-xl border border-indigo-200 overflow-hidden">
      {/* Header — click to toggle */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full px-4 py-3 border-b border-indigo-200 bg-white/60 hover:bg-white/80 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-indigo-600 flex items-center justify-center">
            <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-indigo-900">{title}</h3>
          <span className="text-[10px] text-indigo-400 ml-auto mr-2">Copy prompt → Paste in chatbot → Paste response back</span>
          <svg className={`w-4 h-4 text-indigo-400 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {open && (<>
      {/* Step: Idle — show prompt buttons */}
      {step === "idle" && (
        <div className="px-4 py-3 space-y-2">
          <p className="text-[10px] uppercase font-semibold text-indigo-400 tracking-wider">Generate a prompt</p>
          <div className="flex flex-wrap gap-1.5">
            {prompts.map((p, i) => (
              <button
                key={i}
                onClick={() => handleSelectPrompt(p.question, p.label)}
                className={`text-[11px] px-2.5 py-1.5 rounded-lg border transition-colors ${
                  p.primary
                    ? "bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700 font-semibold"
                    : "bg-white text-indigo-700 border-indigo-200 hover:bg-indigo-100"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Custom question */}
          <form onSubmit={handleCustomSubmit} className="flex gap-1.5 mt-2">
            <input
              type="text"
              value={customQ}
              onChange={(e) => setCustomQ(e.target.value)}
              placeholder="Type a custom question..."
              className="flex-1 text-xs px-3 py-1.5 rounded-lg border border-indigo-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            <button
              type="submit"
              disabled={!customQ.trim()}
              className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              Generate
            </button>
          </form>
        </div>
      )}

      {/* Step: Prompt generated — show prompt + copy + paste-back */}
      {step === "prompt" && (
        <div className="px-4 py-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-indigo-700">
              Prompt: <span className="text-indigo-900">{activePrompt}</span>
            </span>
            <button onClick={handleReset} className="text-[10px] text-gray-500 hover:text-gray-700">
              &larr; Back
            </button>
          </div>

          {/* Step 1: Copy prompt */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] uppercase font-semibold text-indigo-400 tracking-wider">
                Step 1: Copy this prompt to your AI chatbot
              </p>
              <button
                onClick={handleCopy}
                className={`text-[11px] px-2.5 py-1 rounded-md border transition-colors ${
                  copied
                    ? "bg-green-100 text-green-700 border-green-300"
                    : "bg-white text-indigo-600 border-indigo-200 hover:bg-indigo-50"
                }`}
              >
                {copied ? "Copied!" : "Copy to Clipboard"}
              </button>
            </div>
            <textarea
              ref={promptRef}
              readOnly
              value={generatedPrompt}
              className="w-full h-32 text-[11px] font-mono p-3 rounded-lg border border-indigo-200 bg-white text-gray-700 resize-y focus:outline-none"
            />
          </div>

          {/* Step 2: Paste response */}
          <div>
            <p className="text-[10px] uppercase font-semibold text-indigo-400 tracking-wider mb-1">
              Step 2: Paste the AI response here
            </p>
            <textarea
              value={pastedResponse}
              onChange={(e) => setPastedResponse(e.target.value)}
              placeholder="Paste the AI chatbot's response here..."
              className="w-full h-32 text-xs p-3 rounded-lg border border-indigo-200 bg-white text-gray-700 resize-y focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            <div className="flex justify-end mt-1.5">
              <button
                onClick={handleApplyResponse}
                disabled={!pastedResponse.trim()}
                className="text-xs px-4 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                Display Response
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step: Response displayed */}
      {step === "response" && (
        <div className="px-4 py-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-indigo-700">
              Response for: <span className="text-indigo-900">{activePrompt}</span>
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => { setStep("prompt"); setDisplayedResponse(""); }}
                className="text-[10px] text-indigo-500 hover:text-indigo-700"
              >
                Edit
              </button>
              <button onClick={handleReset} className="text-[10px] text-gray-500 hover:text-gray-700">
                New Prompt
              </button>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-indigo-100 p-3">
            <div className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap">{displayedResponse}</div>
          </div>
        </div>
      )}
      </>)}
    </div>
  );
}
