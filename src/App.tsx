import { useState, useEffect, useRef } from 'react';
import { GoogleGenAI } from '@google/genai';
import { Loader2, CheckCircle2, XCircle, Play, Video, AlertCircle, ListPlus, FolderOpen, Upload, Pause, Square, Trash2, Hourglass, RefreshCw, Plus, Minus } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

type TaskStatus = 'idle' | 'generating' | 'polling' | 'done' | 'error';
type QueueStatus = 'idle' | 'running' | 'paused';

interface Task {
  id: string;
  prompt: string;
  status: TaskStatus;
  videoUrl?: string;
  error?: string;
  startTime?: number;
  endTime?: number;
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
  const [queueStatus, setQueueStatus] = useState<QueueStatus>('idle');
  const [workers, setWorkers] = useState(2);
  const [dirHandle, setDirHandle] = useState<any>(null); // FileSystemDirectoryHandle
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [completedTimes, setCompletedTimes] = useState<number[]>([]);

  // Stats
  const totalTasks = tasks.length;
  const doneTasks = tasks.filter(t => t.status === 'done').length;
  const activeTasks = tasks.filter(t => t.status === 'generating' || t.status === 'polling').length;
  const failedTasks = tasks.filter(t => t.status === 'error').length;
  const queuedTasks = tasks.filter(t => t.status === 'idle').length;

  // ETA Calculation
  const avgTime = completedTimes.length > 0 
    ? completedTimes.reduce((a, b) => a + b, 0) / completedTimes.length 
    : 0;
  const etaMs = workers > 0 ? (avgTime * queuedTasks) / workers : 0;
  const etaString = etaMs > 0 
    ? `${Math.floor(etaMs / 60000)}m ${Math.floor((etaMs % 60000) / 1000)}s` 
    : '--';

  // Queue Manager Effect
  useEffect(() => {
    if (queueStatus !== 'running') return;

    if (activeTasks < workers && queuedTasks > 0) {
      const nextTasks = tasks.filter(t => t.status === 'idle').slice(0, workers - activeTasks);
      nextTasks.forEach(t => {
        // Mark as generating immediately to prevent double-starting in next render
        updateTask(t.id, { status: 'generating', startTime: Date.now() });
        processTask(t.id, t.prompt);
      });
    } else if (activeTasks === 0 && queuedTasks === 0 && totalTasks > 0) {
      setQueueStatus('idle');
    }
  }, [tasks, queueStatus, workers, activeTasks, queuedTasks]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        setPromptsText(prev => prev ? prev + '\n' + content : content);
      }
    };
    reader.readAsText(file);
    // Reset input so the same file can be selected again if needed
    e.target.value = '';
  };

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

  const handleAddPrompts = () => {
    const lines = promptsText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) return;

    const newTasks: Task[] = lines.map(line => ({
      id: Math.random().toString(36).substring(7),
      prompt: line,
      status: 'idle'
    }));

    setTasks(prev => [...prev, ...newTasks]);
    setPromptsText('');
  };

  const handleStart = () => {
    handleAddPrompts();
    setQueueStatus('running');
  };

  const handlePause = () => setQueueStatus('paused');
  
  const handleStop = () => {
    setQueueStatus('idle');
    // Optional: mark all idle as error/cancelled if desired, but let's just pause them
  };

  const processTask = async (id: string, prompt: string) => {
    const startTime = Date.now();
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

      const endTime = Date.now();
      setCompletedTimes(prev => [...prev, endTime - startTime]);
      updateTask(id, { status: 'done', videoUrl, endTime });
    } catch (err: any) {
      console.error("Task failed:", err);
      
      let errorMessage = err.message || String(err);
      if (errorMessage.includes("Requested entity was not found")) {
        errorMessage = "API Key error. You may need to re-select your key.";
      }
      
      updateTask(id, { status: 'error', error: errorMessage, endTime: Date.now() });
    }
  };

  const updateTask = (id: string, updates: Partial<Task>) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  };

  const removeTask = (id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id));
  };

  const clearCompleted = () => {
    setTasks(prev => prev.filter(t => t.status !== 'done'));
  };

  const clearAll = () => {
    setTasks([]);
    setQueueStatus('idle');
  };

  return (
    <div className="min-h-screen bg-[#0f1115] text-zinc-100 p-4 md:p-8 font-sans">
      <div className="max-w-[1400px] mx-auto space-y-6">
        
        {/* Top Control Bar */}
        <div className="bg-[#1a1d24] border border-zinc-800 rounded-xl p-4 flex flex-col md:flex-row items-center justify-between gap-4 shadow-lg">
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium text-zinc-400">Workers:</span>
            <div className="flex items-center gap-2 bg-zinc-950 rounded-lg p-1 border border-zinc-800">
              <button 
                onClick={() => setWorkers(Math.max(1, workers - 1))}
                className="w-8 h-8 flex items-center justify-center bg-zinc-900 hover:bg-zinc-800 rounded-md text-zinc-300 transition-colors"
              >
                <Minus className="w-4 h-4" />
              </button>
              <span className="w-8 text-center font-mono text-sm">{workers}</span>
              <button 
                onClick={() => setWorkers(Math.min(10, workers + 1))}
                className="w-8 h-8 flex items-center justify-center bg-zinc-900 hover:bg-zinc-800 rounded-md text-zinc-300 transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button 
              onClick={handleStart}
              disabled={queueStatus === 'running' && promptsText.trim().length === 0}
              className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-5 py-2 rounded-lg font-medium text-sm transition-colors disabled:opacity-50"
            >
              <Play className="w-4 h-4" /> Start
            </button>
            <button 
              onClick={handlePause}
              disabled={queueStatus !== 'running'}
              className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white px-5 py-2 rounded-lg font-medium text-sm transition-colors disabled:opacity-50"
            >
              <Pause className="w-4 h-4" /> Pause
            </button>
            <button 
              onClick={handleStop}
              disabled={queueStatus === 'idle'}
              className="flex items-center gap-2 bg-rose-500 hover:bg-rose-600 text-white px-5 py-2 rounded-lg font-medium text-sm transition-colors disabled:opacity-50"
            >
              <Square className="w-4 h-4" /> Stop
            </button>
            <div className="w-px h-8 bg-zinc-800 mx-2" />
            <button onClick={clearCompleted} className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors px-2">Clear Done</button>
            <button onClick={clearAll} className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors px-2">Clear All</button>
          </div>
        </div>

        {/* Stats Bar */}
        <div className="bg-[#1a1d24] border border-zinc-800 rounded-xl p-6 flex flex-wrap items-center gap-8 md:gap-16 shadow-lg">
          <div className="flex flex-col">
            <span className="text-2xl font-bold text-white">{totalTasks}</span>
            <span className="text-[10px] font-bold text-zinc-500 tracking-wider uppercase">Total</span>
          </div>
          <div className="flex flex-col">
            <span className="text-2xl font-bold text-white">{doneTasks}</span>
            <span className="text-[10px] font-bold text-zinc-500 tracking-wider uppercase">Done</span>
          </div>
          <div className="flex flex-col">
            <span className="text-2xl font-bold text-white">{activeTasks}</span>
            <span className="text-[10px] font-bold text-zinc-500 tracking-wider uppercase">Active</span>
          </div>
          <div className="flex flex-col">
            <span className="text-2xl font-bold text-white">{failedTasks}</span>
            <span className="text-[10px] font-bold text-zinc-500 tracking-wider uppercase">Failed</span>
          </div>
          <div className="flex flex-col">
            <span className="text-2xl font-bold text-indigo-400">{etaString}</span>
            <span className="text-[10px] font-bold text-zinc-500 tracking-wider uppercase">ETA</span>
          </div>
          
          <div className="ml-auto flex items-center gap-4">
            <button 
              onClick={onClearKey}
              className="flex items-center gap-2 text-xs font-medium px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded-full border border-emerald-500/20 transition-colors cursor-pointer"
              title="Click to change API Key"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              API Key Active
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Input Section */}
          <div className="lg:col-span-1 space-y-4">
            <div className="bg-[#1a1d24] border border-zinc-800 rounded-xl p-5 shadow-sm">
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2 text-zinc-300">
                <FolderOpen className="w-4 h-4 text-zinc-500" />
                Download Location
              </h2>
              <button
                onClick={handleSelectFolder}
                className="w-full bg-zinc-900 hover:bg-zinc-800 text-zinc-300 font-medium py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 border border-zinc-800 text-xs mb-2"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                {dirHandle ? 'Change Folder' : 'Select Folder'}
              </button>
              {dirHandle && (
                <p className="text-[10px] text-emerald-400 text-center bg-emerald-500/10 py-1 rounded-md border border-emerald-500/20 truncate px-2">
                  {dirHandle.name}
                </p>
              )}
            </div>

            <div className="bg-[#1a1d24] border border-zinc-800 rounded-xl p-5 shadow-sm flex flex-col h-[calc(100vh-380px)] min-h-[400px]">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold flex items-center gap-2 text-zinc-300">
                  <ListPlus className="w-4 h-4 text-zinc-500" />
                  Add Prompts
                </h2>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="text-[10px] flex items-center gap-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 py-1 px-2 rounded transition-colors border border-zinc-700"
                  title="Import prompts from a .txt file"
                >
                  <Upload className="w-3 h-3" />
                  Import
                </button>
                <input
                  type="file"
                  accept=".txt"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </div>
              <textarea
                value={promptsText}
                onChange={(e) => setPromptsText(e.target.value)}
                placeholder="Enter prompts here..."
                className="w-full flex-1 bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-xs text-zinc-300 placeholder:text-zinc-700 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 resize-none mb-3 font-mono"
              />
              <button
                onClick={handleAddPrompts}
                disabled={promptsText.trim().length === 0}
                className="w-full bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-900 disabled:text-zinc-600 text-zinc-200 font-medium py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 text-xs border border-zinc-700"
              >
                <Plus className="w-3.5 h-3.5" />
                Add to Queue
              </button>
            </div>
          </div>

          {/* Queue Section */}
          <div className="lg:col-span-3 space-y-3">
            {tasks.length === 0 ? (
              <div className="bg-[#1a1d24] border border-zinc-800/50 border-dashed rounded-xl p-12 text-center text-zinc-600 flex flex-col items-center justify-center h-full min-h-[400px]">
                <Video className="w-8 h-8 mb-3 opacity-20" />
                <p className="text-sm">Queue is empty.</p>
              </div>
            ) : (
              <div className="space-y-2">
                <AnimatePresence>
                  {tasks.map((task) => (
                    <TaskRow key={task.id} task={task} onRemove={() => removeTask(task.id)} />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TaskRow({ task, onRemove }: { task: Task; onRemove: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      className="bg-[#1a1d24] border border-zinc-800 rounded-lg p-3 flex items-center gap-4 shadow-sm hover:border-zinc-700 transition-colors group"
    >
      <div className="w-12 h-12 shrink-0 bg-zinc-900 rounded-md border border-zinc-800 flex items-center justify-center text-[10px] font-bold text-zinc-600 tracking-wider">
        {task.status === 'done' && task.videoUrl ? (
          <video src={task.videoUrl} className="w-full h-full object-cover rounded-md" muted />
        ) : 'VID'}
      </div>
      
      <div className="flex-1 min-w-0 flex flex-col justify-center">
        <p className="text-sm text-zinc-300 truncate font-medium mb-1.5" title={task.prompt}>
          {task.prompt}
        </p>
        <div className="flex items-center gap-3">
          <StatusBadge status={task.status} />
          {task.status === 'polling' && (
            <div className="flex-1 h-1 bg-zinc-900 rounded-full overflow-hidden max-w-[200px]">
              <motion.div 
                className="h-full bg-indigo-500"
                initial={{ width: "0%" }}
                animate={{ width: "100%" }}
                transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
              />
            </div>
          )}
          {task.status === 'error' && (
            <span className="text-xs text-red-400 truncate max-w-[300px]">{task.error}</span>
          )}
        </div>
      </div>

      <button 
        onClick={onRemove}
        className="w-8 h-8 shrink-0 flex items-center justify-center text-zinc-600 hover:text-rose-400 hover:bg-rose-500/10 rounded-md transition-colors opacity-0 group-hover:opacity-100"
        title="Remove task"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </motion.div>
  );
}

function StatusBadge({ status }: { status: TaskStatus }) {
  switch (status) {
    case 'idle':
      return <span className="text-[10px] font-bold text-zinc-500 tracking-wider uppercase flex items-center gap-1.5 bg-zinc-900 px-2 py-0.5 rounded"><Hourglass className="w-3 h-3" /> Queued</span>;
    case 'generating':
      return <span className="text-[10px] font-bold text-amber-400 tracking-wider uppercase flex items-center gap-1.5 bg-amber-500/10 px-2 py-0.5 rounded"><Loader2 className="w-3 h-3 animate-spin" /> Starting</span>;
    case 'polling':
      return <span className="text-[10px] font-bold text-indigo-400 tracking-wider uppercase flex items-center gap-1.5 bg-indigo-500/10 px-2 py-0.5 rounded"><RefreshCw className="w-3 h-3 animate-spin" /> Running</span>;
    case 'done':
      return <span className="text-[10px] font-bold text-emerald-400 tracking-wider uppercase flex items-center gap-1.5 bg-emerald-500/10 px-2 py-0.5 rounded"><CheckCircle2 className="w-3 h-3" /> Done</span>;
    case 'error':
      return <span className="text-[10px] font-bold text-red-400 tracking-wider uppercase flex items-center gap-1.5 bg-red-500/10 px-2 py-0.5 rounded"><XCircle className="w-3 h-3" /> Failed</span>;
  }
}
