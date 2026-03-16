import { useState, useEffect } from 'react';
import { GoogleGenAI } from '@google/genai';
import { Loader2, CheckCircle2, XCircle, Play, Video, AlertCircle, ListPlus, FolderOpen } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

type TaskStatus = 'idle' | 'generating' | 'polling' | 'done' | 'error';

interface Task {
  id: string;
  prompt: string;
  status: TaskStatus;
  videoUrl?: string;
  error?: string;
}

export default function App() {
  const [apiKey, setApiKey] = useState<string>('');

  if (!apiKey) {
    return <ApiKeySelector onKeySubmit={setApiKey} />;
  }

  return <BatchGenerator apiKey={apiKey} onClearKey={() => setApiKey('')} />;
}

function ApiKeySelector({ onKeySubmit }: { onKeySubmit: (key: string) => void }) {
  const [inputKey, setInputKey] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputKey.trim()) {
      onKeySubmit(inputKey.trim());
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-zinc-950 text-zinc-100 p-6 font-sans">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full bg-zinc-900 border border-zinc-800 rounded-2xl p-8 shadow-2xl text-center"
      >
        <div className="w-16 h-16 bg-indigo-500/10 text-indigo-400 rounded-full flex items-center justify-center mx-auto mb-6">
          <Video className="w-8 h-8" />
        </div>
        <h1 className="text-2xl font-bold mb-4 tracking-tight">Veo Batch Generator</h1>
        <p className="text-zinc-400 mb-6 text-sm leading-relaxed">
          This application uses the Veo 3.1 Fast model for high-quality video generation.
          Please enter your paid Google Cloud API key to continue.
          <br /><br />
          <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noreferrer" className="text-indigo-400 hover:text-indigo-300 hover:underline transition-colors">
            Learn more about billing requirements
          </a>
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            value={inputKey}
            onChange={(e) => setInputKey(e.target.value)}
            placeholder="AIzaSy..."
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-sm text-zinc-300 placeholder:text-zinc-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 font-mono"
            autoFocus
          />
          <button
            type="submit"
            disabled={!inputKey.trim()}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-zinc-800 disabled:text-zinc-500 text-white font-medium py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            <Play className="w-4 h-4" />
            Start Generating
          </button>
        </form>
      </motion.div>
    </div>
  );
}

function BatchGenerator({ apiKey, onClearKey }: { apiKey: string, onClearKey: () => void }) {
  const [promptsText, setPromptsText] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [dirHandle, setDirHandle] = useState<any>(null); // FileSystemDirectoryHandle

  const handleSelectFolder = async () => {
    try {
      if ('showDirectoryPicker' in window) {
        const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
        setDirHandle(handle);
      } else {
        alert("Your browser doesn't support selecting a download folder. Videos will use the default Downloads folder.");
      }
    } catch (err) {
      console.error("Error selecting folder:", err);
    }
  };

  const handleStart = async () => {
    const lines = promptsText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) return;

    const newTasks: Task[] = lines.map(line => ({
      id: Math.random().toString(36).substring(7),
      prompt: line,
      status: 'idle'
    }));

    setTasks(prev => [...prev, ...newTasks]);
    setPromptsText('');
    setIsProcessing(true);

    // Process sequentially to avoid hitting rate limits too hard
    for (const task of newTasks) {
      await processTask(task.id, task.prompt);
    }
    
    setIsProcessing(false);
  };

  const processTask = async (id: string, prompt: string) => {
    updateTask(id, { status: 'generating' });
    try {
      if (!apiKey) throw new Error("API Key is missing.");

      const ai = new GoogleGenAI({ apiKey });

      let operation = await ai.models.generateVideos({
        model: 'veo-3.1-fast-generate-preview',
        prompt: prompt,
        config: {
          numberOfVideos: 1,
          resolution: '720p',
          aspectRatio: '16:9'
        }
      });

      updateTask(id, { status: 'polling' });

      while (!operation.done) {
        await new Promise(resolve => setTimeout(resolve, 10000));
        operation = await ai.operations.getVideosOperation({ operation });
      }

      if (operation.error) {
        throw new Error(operation.error.message || 'Unknown error during generation');
      }

      const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
      if (!downloadLink) throw new Error('No video URI returned from the model');

      const response = await fetch(downloadLink, {
        method: 'GET',
        headers: {
          'x-goog-api-key': apiKey,
        },
      });

      if (!response.ok) throw new Error(`Failed to download video: ${response.statusText}`);

      const blob = await response.blob();
      const videoUrl = URL.createObjectURL(blob);

      const safePrompt = prompt.slice(0, 30).replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const filename = `veo_${safePrompt}_${id}.mp4`;

      // Try to save to selected folder, fallback to default download
      let savedToFolder = false;
      if (dirHandle) {
        try {
          const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(blob);
          await writable.close();
          savedToFolder = true;
        } catch (err) {
          console.error("Failed to save to selected folder, falling back to default download.", err);
        }
      }

      if (!savedToFolder) {
        // Auto-download the video (fallback)
        const a = document.createElement('a');
        a.href = videoUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }

      updateTask(id, { status: 'done', videoUrl });
    } catch (err: any) {
      console.error("Task failed:", err);
      
      // Handle the "Requested entity was not found" race condition or invalid key
      let errorMessage = err.message || String(err);
      if (errorMessage.includes("Requested entity was not found")) {
        errorMessage = "API Key error. You may need to re-select your key.";
      }
      
      updateTask(id, { status: 'error', error: errorMessage });
    }
  };

  const updateTask = (id: string, updates: Partial<Task>) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  };

  const clearCompleted = () => {
    setTasks(prev => prev.filter(t => t.status !== 'done' && t.status !== 'error'));
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6 md:p-12 font-sans">
      <div className="max-w-6xl mx-auto space-y-8">
        <header className="flex items-center justify-between border-b border-zinc-800 pb-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
              <Video className="w-8 h-8 text-indigo-500" />
              Veo Batch Generator
            </h1>
            <p className="text-zinc-400 mt-2">Generate multiple videos sequentially using Veo 3.1 Fast.</p>
          </div>
          <button 
            onClick={onClearKey}
            className="flex items-center gap-2 text-sm font-medium px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded-full border border-emerald-500/20 transition-colors cursor-pointer"
            title="Click to change API Key"
          >
            <CheckCircle2 className="w-4 h-4" />
            API Key Active
          </button>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Input Section */}
          <div className="lg:col-span-1 space-y-4">
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-sm">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <FolderOpen className="w-5 h-5 text-zinc-400" />
                Download Location
              </h2>
              <p className="text-xs text-zinc-500 mb-4">Select a folder to automatically save the generated videos.</p>
              <button
                onClick={handleSelectFolder}
                className="w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium py-2.5 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 border border-zinc-700 text-sm mb-2"
              >
                <FolderOpen className="w-4 h-4" />
                {dirHandle ? 'Change Folder' : 'Select Folder'}
              </button>
              {dirHandle && (
                <p className="text-xs text-emerald-400 text-center bg-emerald-500/10 py-1.5 rounded-lg border border-emerald-500/20">
                  Saving to: <strong>{dirHandle.name}</strong>
                </p>
              )}
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-sm">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <ListPlus className="w-5 h-5 text-zinc-400" />
                Add Prompts
              </h2>
              <p className="text-xs text-zinc-500 mb-4">Enter one prompt per line. Each line will generate a separate 720p 16:9 video.</p>
              <textarea
                value={promptsText}
                onChange={(e) => setPromptsText(e.target.value)}
                placeholder="A neon hologram of a cat driving at top speed&#10;A cinematic shot of a futuristic city in the rain&#10;..."
                className="w-full h-64 bg-zinc-950 border border-zinc-800 rounded-xl p-4 text-sm text-zinc-300 placeholder:text-zinc-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 resize-none mb-4 font-mono"
                disabled={isProcessing}
              />
              <button
                onClick={handleStart}
                disabled={isProcessing || promptsText.trim().length === 0}
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-zinc-800 disabled:text-zinc-500 text-white font-medium py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Processing Queue...
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" />
                    Start Batch
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Queue Section */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                Queue & Results
                <span className="bg-zinc-800 text-zinc-300 text-xs py-0.5 px-2 rounded-full">
                  {tasks.length}
                </span>
              </h2>
              {tasks.some(t => t.status === 'done' || t.status === 'error') && !isProcessing && (
                <button 
                  onClick={clearCompleted}
                  className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  Clear Completed
                </button>
              )}
            </div>

            <div className="space-y-4">
              {tasks.length === 0 ? (
                <div className="bg-zinc-900/50 border border-zinc-800/50 border-dashed rounded-2xl p-12 text-center text-zinc-500 flex flex-col items-center justify-center">
                  <Video className="w-8 h-8 mb-3 opacity-20" />
                  <p>Your queue is empty.</p>
                  <p className="text-sm mt-1">Add prompts on the left to start generating.</p>
                </div>
              ) : (
                <AnimatePresence>
                  {tasks.map((task, index) => (
                    <TaskCard key={task.id} task={task} index={index} />
                  ))}
                </AnimatePresence>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TaskCard({ task, index }: { task: Task; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-sm"
    >
      <div className="p-4 sm:p-6 flex flex-col sm:flex-row gap-6">
        <div className="flex-1 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-xs font-mono text-zinc-500 bg-zinc-950 px-2 py-1 rounded-md">
                #{index + 1}
              </span>
              <StatusBadge status={task.status} />
            </div>
          </div>
          <p className="text-sm text-zinc-300 leading-relaxed font-medium">
            "{task.prompt}"
          </p>
          
          {task.status === 'error' && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs p-3 rounded-lg flex items-start gap-2 mt-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <p className="break-words">{task.error}</p>
            </div>
          )}
        </div>

        {/* Video Preview Area */}
        <div className="w-full sm:w-64 shrink-0 bg-zinc-950 rounded-xl overflow-hidden aspect-video relative border border-zinc-800/50 flex items-center justify-center">
          {task.status === 'done' && task.videoUrl ? (
            <video 
              src={task.videoUrl} 
              controls 
              autoPlay 
              loop 
              muted 
              className="w-full h-full object-cover"
            />
          ) : task.status === 'generating' || task.status === 'polling' ? (
            <div className="flex flex-col items-center justify-center text-zinc-500">
              <Loader2 className="w-6 h-6 animate-spin mb-2 text-indigo-500" />
              <span className="text-xs font-medium">
                {task.status === 'generating' ? 'Initializing...' : 'Rendering...'}
              </span>
            </div>
          ) : task.status === 'error' ? (
            <div className="text-zinc-600 flex flex-col items-center">
              <XCircle className="w-6 h-6 mb-2" />
              <span className="text-xs">Failed</span>
            </div>
          ) : (
            <div className="text-zinc-700 flex flex-col items-center">
              <Video className="w-6 h-6 mb-2 opacity-50" />
              <span className="text-xs">Waiting</span>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function StatusBadge({ status }: { status: TaskStatus }) {
  switch (status) {
    case 'idle':
      return <span className="text-xs font-medium text-zinc-500 flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-zinc-600" /> Queued</span>;
    case 'generating':
      return <span className="text-xs font-medium text-amber-400 flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Starting</span>;
    case 'polling':
      return <span className="text-xs font-medium text-indigo-400 flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Generating</span>;
    case 'done':
      return <span className="text-xs font-medium text-emerald-400 flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3" /> Complete</span>;
    case 'error':
      return <span className="text-xs font-medium text-red-400 flex items-center gap-1.5"><XCircle className="w-3 h-3" /> Error</span>;
  }
}
