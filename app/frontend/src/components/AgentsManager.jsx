import React, { useState, useEffect, useRef, useCallback, useLayoutEffect } from "react";
import { Cpu, Plus, Trash2, Play, StopCircle, UploadCloud, MessageSquare, Settings, Database, Activity, FileText, Terminal, Loader2, ChevronDown, Bot, Send, Square, Paperclip, Globe2, X } from "lucide-react";
import { streamAgentChat, getLlmStatus } from "../services/api";
import { MarkdownRenderer } from "./TextChat";

const processMessageContent = (rawText, apiReasoning = "", enableThinking = true) => {
  if (typeof rawText !== "string") {
    return { content: rawText, reasoning: apiReasoning || "" };
  }

  const cleanReasoningControlTags = (value) => String(value || "")
    .replace(/<\|channel\|>thought/g, "")
    .replace(/<\|channel\|>model/g, "")
    .replace(/<\|turn\|>model/g, "")
    .replace(/<\|im_start\|>model/g, "")
    .replace(/<\|think\|>|<\|thought\|>|<thinking>|<thought>/g, "")
    .replace(/<\|\/think\|>|<\|\/thought\|>|<\/thinking>|<\/thought>/g, "")
    .trim();

  const startTags = ["<|channel|>thought", "<|think|>", "<|thought|>", "<thinking>", "<thought>"];
  const endTags = ["<|channel|>model", "<|turn>model", "<|im_start|>model", "</thinking>", "</thought>", "<|/think|>", "<|/thought|>"];

  if (!enableThinking) {
    return { content: cleanReasoningControlTags(rawText), reasoning: "" };
  }

  let startIdx = -1;
  let matchedStartTag = "";

  for (const tag of startTags) {
    const idx = rawText.indexOf(tag);
    if (idx !== -1 && (startIdx === -1 || idx < startIdx)) {
      startIdx = idx;
      matchedStartTag = tag;
    }
  }

  if (startIdx === -1) {
    return { content: cleanReasoningControlTags(rawText), reasoning: "" };
  }

  let endIdx = -1;
  for (const tag of endTags) {
    const idx = rawText.indexOf(tag, startIdx + matchedStartTag.length);
    if (idx !== -1 && (endIdx === -1 || idx < endIdx)) {
      endIdx = idx;
    }
  }

  if (endIdx === -1) {
    const rawReasoning = rawText.substring(startIdx + matchedStartTag.length);
    return { content: "", reasoning: cleanReasoningControlTags(rawReasoning) };
  }

  const rawReasoning = rawText.substring(startIdx + matchedStartTag.length, endIdx);
  const rawContent = rawText.substring(endIdx);

  return {
    content: cleanReasoningControlTags(rawContent),
    reasoning: cleanReasoningControlTags(rawReasoning)
  };
};

function ChatThinkingSection({ reasoning, timeElapsed, isComplete }) {
  const [isExpanded, setIsExpanded] = useState(true);

  const formattedTime = timeElapsed > 0 
    ? ` (${timeElapsed.toFixed(timeElapsed < 10 ? 1 : 0)}s)`
    : "";

  return (
    <div className="chat-thinking-container">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="chat-thinking-header"
      >
        <span className="chat-thinking-title">
          {isComplete ? `Ход мыслей${formattedTime}` : `Думает...${formattedTime}`}
        </span>
        <ChevronDown
          size={14}
          style={{
            transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.2s ease",
          }}
        />
      </button>
      {isExpanded && (
        <div className="chat-thinking-content">
          {reasoning}
        </div>
      )}
    </div>
  );
}

export default function AgentsManager({ showAlert, showConfirm, selectedAgentIdForChat, setSelectedAgentIdForChat }) {
  const [agents, setAgents] = useState([]);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [activeSubTab, setActiveSubTab] = useState("settings"); // 'settings', 'rag', 'jobs', 'chat'
  
  // Agent Form State
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [ragScope, setRagScope] = useState("personal");

  // RAG State
  const [ragFiles, setRagFiles] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef(null);

  // Background Jobs State
  const [jobs, setJobs] = useState([]);
  const [newTaskPrompt, setNewTaskPrompt] = useState("");
  const [selectedJob, setSelectedJob] = useState(null);
  const [jobLogs, setJobLogs] = useState("");
  const [isStartingJob, setIsStartingJob] = useState(false);
  const logPollingRef = useRef(null);

  // Playground Chat State
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [isChatSending, setIsChatSending] = useState(false);
  const [isRagUploading, setIsRagUploading] = useState(false);

  const [status, setStatus] = useState({ ready: false, running: false, settings: {} });
  const [attachments, setAttachments] = useState([]);
  const [useWebSearch, setUseWebSearch] = useState(false);
  const [deepThinkEnabled, setDeepThinkEnabled] = useState(false);
  const [webTimeFilter, setWebTimeFilter] = useState("any");
  const composerFileInputRef = useRef(null);

  const supportsVision = Boolean(status.ready && status.settings?.supportsVision);
  const supportsThinking = Boolean(status.ready && status.settings?.supportsThinking);
  const visionStatus = status.settings?.visionStatus || "Ввод изображений требует mmproj-файла проектора.";

  const isImage = (file) => {
    return /\.(jpe?g|png|webp)$/i.test(file.name) || file.type.startsWith("image/");
  };

  const isTextFile = (file) => {
    return /\.(txt|md|csv|js|jsx|ts|tsx|py|json|css|html|java|cpp|c|h|rs|go|sh|bat|xml|yaml|yml)$/i.test(file.name) || file.type.startsWith("text/");
  };

  const optimizeImageForVision = (file, maxSide = 1024, quality = 0.92) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.onload = () => {
      const originalDataUrl = reader.result;
      const img = new Image();
      img.onerror = () => reject(new Error(`Could not decode ${file.name}`));
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        const sendDataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve({
          previewDataUrl: originalDataUrl,
          sendDataUrl,
          originalWidth: img.width,
          originalHeight: img.height,
          width,
          height,
        });
      };
      img.src = originalDataUrl;
    };
    reader.readAsDataURL(file);
  });

  const handleComposerFileChange = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    e.target.value = "";

    for (const file of files) {
      if (isImage(file)) {
        try {
          const optimized = await optimizeImageForVision(file);
          setAttachments(prev => [...prev, {
            id: "att_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
            name: file.name,
            type: "image",
            dataUrl: optimized.sendDataUrl,
          }]);
        } catch (err) {
          await showAlert({ title: "Ошибка", message: `Не удалось обработать изображение ${file.name}: ${err.message}`, danger: true });
        }
      } else if (isTextFile(file) || file.name.toLowerCase().endsWith(".pdf")) {
        if (!selectedAgent) {
          await showAlert({ title: "Агент не выбран", message: "Выберите агента перед прикреплением документа.", danger: true });
          continue;
        }
        if (file.size > 10 * 1024 * 1024) {
          await showAlert({ title: "Файл слишком большой", message: `Файл ${file.name} превышает лимит 10 МБ.`, danger: true });
          continue;
        }
        setIsRagUploading(true);
        try {
          const res = await fetch(`/api/agents/${selectedAgent.id}/rag/upload?filename=${encodeURIComponent(file.name)}`, {
            method: "POST",
            body: file,
          });
          const data = await res.json();
          if (res.ok && data.ok) {
            // Non-blocking: insert a system note into the chat so user knows the file is indexed
            setChatMessages(prev => [...prev, {
              role: "system-note",
              content: `📄 Файл «${file.name}» добавлен в базу знаний RAG. Задайте ваш вопрос.`,
            }]);
            fetchRagFiles(selectedAgent.id);
          } else {
            await showAlert({ title: "Ошибка загрузки", message: data.error || "Не удалось загрузить файл в базу знаний.", danger: true });
          }
        } catch (err) {
          await showAlert({ title: "Ошибка", message: err.message, danger: true });
        } finally {
          setIsRagUploading(false);
        }
      } else {
        await showAlert({ title: "Формат не поддерживается", message: `Файл ${file.name} должен быть изображением (JPG/PNG/WebP), текстовым документом или PDF.`, danger: true });
      }
    }
  };



  const updateLlmStatus = async () => {
    try {
      const s = await getLlmStatus();
      setStatus(s);
    } catch (_) {}
  };

  useEffect(() => {
    if (activeSubTab === "chat") {
      updateLlmStatus();
    }
  }, [activeSubTab]);

  const [isCreateMode, setIsCreateMode] = useState(false);

  const chatMessagesRef = useRef(null);
  const textareaRef = useRef(null);
  const abortControllerRef = useRef(null);

  const resizeComposerInput = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const maxHeight = 104;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, []);

  useLayoutEffect(() => {
    resizeComposerInput();
  }, [chatInput, resizeComposerInput]);

  useEffect(() => {
    if (chatMessagesRef.current) {
      chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
    }
  }, [chatMessages]);

  // Load list of agents
  const fetchAgents = async () => {
    try {
      const res = await fetch("/api/agents");
      const data = await res.json();
      if (data.ok) {
        setAgents(data.agents || []);
      }
    } catch (err) {
      console.error("Failed to load agents:", err);
    }
  };

  useEffect(() => {
    fetchAgents();
  }, []);

  useEffect(() => {
    if (selectedAgentIdForChat) {
      if (selectedAgentIdForChat === "create") {
        handleCreateNewAgent();
      } else if (agents.length > 0) {
        const found = agents.find(a => a.id === selectedAgentIdForChat);
        if (found) {
          selectAgent(found);
          setActiveSubTab("chat");
        }
      }
      setSelectedAgentIdForChat(null);
    }
  }, [selectedAgentIdForChat, agents]);

  const selectAgent = (agent) => {
    setSelectedAgent(agent);
    setIsCreateMode(false);
    setName(agent.name);
    setDescription(agent.description || "");
    setSystemPrompt(agent.system_prompt);
    setRagScope(agent.rag_scope);
    
    // Clear sub states
    setRagFiles([]);
    setJobs([]);
    setSelectedJob(null);
    setJobLogs("");
    setChatMessages([]);
    
    // Fetch files, jobs, and chats for this agent
    fetchRagFiles(agent.id);
    fetchAgentJobs(agent.id);
    fetchAgentChats(agent.id);
  };

  // RAG API Actions
  const fetchRagFiles = async (agentId) => {
    try {
      const res = await fetch(`/api/agents/${agentId}/rag/files`);
      const data = await res.json();
      if (data.ok) {
        setRagFiles(data.files || []);
      }
    } catch (err) {
      console.error("Failed to fetch RAG files:", err);
    }
  };

  const fetchAgentChats = async (agentId) => {
    try {
      const res = await fetch(`/api/agents/${agentId}/chats`);
      const data = await res.json();
      if (data.ok) {
        setChatMessages(data.chats || []);
      }
    } catch (err) {
      console.error("Failed to fetch agent chats:", err);
    }
  };

  const handleClearChatHistory = async () => {
    if (!selectedAgent) return;
    const confirm = await showConfirm({
      title: "Очистить историю чата",
      message: "Вы действительно хотите удалить всю историю переписки с этим агентом?",
      danger: true
    });
    if (!confirm) return;
    try {
      const res = await fetch(`/api/agents/${selectedAgent.id}/chats`, { method: "DELETE" });
      if (res.ok) {
        setChatMessages([]);
        await showAlert({ title: "Успешно", message: "История переписки очищена." });
      }
    } catch (err) {
      console.error("Failed to clear chat history:", err);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !selectedAgent) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`/api/agents/${selectedAgent.id}/rag/upload?filename=${encodeURIComponent(file.name)}`, {
        method: "POST",
        body: file,
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        await showAlert({ title: "Успешно", message: `Файл "${file.name}" успешно загружен и обработан в RAG.` });
        fetchRagFiles(selectedAgent.id);
      } else {
        await showAlert({ title: "Ошибка", message: data.error || "Не удалось загрузить файл.", danger: true });
      }
    } catch (err) {
      await showAlert({ title: "Ошибка", message: err.message, danger: true });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDeleteFile = async (fileId, filename) => {
    const confirm = await showConfirm({
      title: "Удалить файл",
      message: `Вы действительно хотите удалить файл "${filename}" из базы знаний?`,
      danger: true,
    });
    if (!confirm) return;

    try {
      const res = await fetch(`/api/agents/${selectedAgent.id}/rag/files/${fileId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        fetchRagFiles(selectedAgent.id);
      }
    } catch (err) {
      console.error("Failed to delete RAG file:", err);
    }
  };

  // Agent CRUD
  const handleSaveAgentSettings = async () => {
    if (!name.trim() || !systemPrompt.trim()) {
      await showAlert({ title: "Ошибка", message: "Имя и Системный промпт обязательны.", danger: true });
      return;
    }

    const payload = { name, description, system_prompt: systemPrompt, rag_scope: ragScope };

    try {
      if (selectedAgent) {
        const res = await fetch(`/api/agents/${selectedAgent.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          await showAlert({ title: "Сохранено", message: "Настройки агента обновлены." });
          fetchAgents();
        }
      } else {
        const res = await fetch("/api/agents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (res.ok && data.ok) {
          await fetchAgents();
          setSelectedAgent({ id: data.id, ...payload });
          setIsCreateMode(false);
          await showAlert({ title: "Успешно", message: `Агент "${name}" создан!` });
        }
      }
    } catch (err) {
      await showAlert({ title: "Ошибка", message: err.message, danger: true });
    }
  };

  const handleCreateNewAgent = () => {
    setSelectedAgent(null);
    setIsCreateMode(true);
    setName("Новый Агент");
    setDescription("");
    setSystemPrompt("Ты — полезный локальный ассистент.");
    setRagScope("personal");
    setRagFiles([]);
    setJobs([]);
    setSelectedJob(null);
    setJobLogs("");
    setChatMessages([]);
    setActiveSubTab("settings");
  };

  const handleDeleteAgent = async () => {
    if (!selectedAgent) return;
    const confirm = await showConfirm({
      title: "Удалить агента",
      message: `Вы действительно хотите удалить агента "${selectedAgent.name}"? Это также сотрет всю историю запусков и личные RAG файлы.`,
      danger: true,
    });
    if (!confirm) return;

    try {
      const res = await fetch(`/api/agents/${selectedAgent.id}`, { method: "DELETE" });
      if (res.ok) {
        setSelectedAgent(null);
        setIsCreateMode(false);
        fetchAgents();
      }
    } catch (err) {
      console.error("Failed to delete agent:", err);
    }
  };

  // Background Jobs
  const fetchAgentJobs = async (agentId) => {
    try {
      const res = await fetch(`/api/agents/${agentId}/jobs`);
      const data = await res.json();
      if (data.ok) {
        setJobs(data.jobs || []);
      }
    } catch (err) {
      console.error("Failed to fetch jobs:", err);
    }
  };

  const handleStartBackgroundJob = async () => {
    if (!newTaskPrompt.trim() || !selectedAgent) return;

    setIsStartingJob(true);
    try {
      const res = await fetch(`/api/agents/${selectedAgent.id}/run-background`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_prompt: newTaskPrompt }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setNewTaskPrompt("");
        fetchAgentJobs(selectedAgent.id);
      } else {
        await showAlert({ title: "Ошибка запуска", message: data.error || "Не удалось запустить задачу в фоне.", danger: true });
      }
    } catch (err) {
      await showAlert({ title: "Ошибка", message: err.message, danger: true });
    } finally {
      setIsStartingJob(false);
    }
  };

  const handleStopJob = async (jobId) => {
    try {
      const res = await fetch(`/api/agents/jobs/${jobId}/stop`, { method: "POST" });
      if (res.ok) {
        fetchAgentJobs(selectedAgent.id);
      }
    } catch (err) {
      console.error("Failed to stop job:", err);
    }
  };

  // Log Polling
  useEffect(() => {
    if (selectedJob && (selectedJob.status === "running" || selectedJob.status === "pending")) {
      const pollLogs = async () => {
        try {
          const res = await fetch(`/api/agents/jobs/${selectedJob.id}/logs`);
          const data = await res.json();
          if (data.ok) {
            setJobLogs(data.logs || "");
          }
          // Also refresh job status
          const statusRes = await fetch(`/api/agents/jobs/${selectedJob.id}/status`);
          const statusData = await statusRes.json();
          if (statusData.ok) {
            setSelectedJob(statusData.job);
            // Update in job list too
            setJobs(prev => prev.map(j => j.id === selectedJob.id ? statusData.job : j));
          }
        } catch (err) {
          console.error("Error polling logs:", err);
        }
      };

      pollLogs();
      logPollingRef.current = setInterval(pollLogs, 1500);
    } else {
      if (logPollingRef.current) {
        clearInterval(logPollingRef.current);
        logPollingRef.current = null;
      }
    }

    return () => {
      if (logPollingRef.current) {
        clearInterval(logPollingRef.current);
        logPollingRef.current = null;
      }
    };
  }, [selectedJob]);

  const viewJobDetails = async (job) => {
    setSelectedJob(job);
    setJobLogs("Загрузка логов...");
    try {
      const res = await fetch(`/api/agents/jobs/${job.id}/logs`);
      const data = await res.json();
      if (data.ok) {
        setJobLogs(data.logs || "Логи отсутствуют.");
      }
    } catch (err) {
      setJobLogs("Не удалось загрузить логи: " + err.message);
    }
  };

  // Playground Chat API
  const handleSendPlaygroundChat = async () => {
    if ((!chatInput.trim() && attachments.length === 0) || !selectedAgent || isChatSending) return;

    // Only image attachments are sent inline — text documents are uploaded to RAG automatically
    const imageAttachments = attachments.filter(att => att.type === "image");
    const displayCombinedText = chatInput.trim();

    let requestUserMessageContent;
    if (imageAttachments.length > 0) {
      requestUserMessageContent = [
        {
          type: "text",
          text: displayCombinedText
        },
        ...imageAttachments.map((img) => ({
          type: "image_url",
          image_url: {
            url: img.dataUrl
          }
        }))
      ];
    } else {
      requestUserMessageContent = displayCombinedText;
    }

    const userMsg = { role: "user", content: requestUserMessageContent };
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput("");
    setAttachments([]); // Clear attachments
    setIsChatSending(true);


    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Insert assistant placeholder for streaming
    setChatMessages(prev => [...prev, { role: "assistant", content: "", reasoning: "", thinkingDuration: 0, webSources: [] }]);

    const requestStartedAt = performance.now();
    let streamedTokens = 0;
    let firstTokenAt = null;
    let thinkingStartedAt = null;
    let thinkingEndedAt = null;
    let thinkingDuration = 0;

    try {
      await streamAgentChat(selectedAgent.id, requestUserMessageContent, {
        useWeb: useWebSearch,
        timeFilter: webTimeFilter,
        enableThinking: deepThinkEnabled,
        signal: controller.signal
      }, (token, fullText, reasoningToken, fullReasoning, webSources) => {
        const now = performance.now();
        if (streamedTokens === 0) {
          firstTokenAt = now;
        }
        streamedTokens += 1;

        if (reasoningToken && !thinkingStartedAt) {
          thinkingStartedAt = now;
        }
        if (token && thinkingStartedAt && !thinkingEndedAt) {
          thinkingEndedAt = now;
          thinkingDuration = (thinkingEndedAt - thinkingStartedAt) / 1000;
        }

        const currentThinkingDuration = thinkingEndedAt 
          ? thinkingDuration 
          : (thinkingStartedAt ? (now - thinkingStartedAt) / 1000 : 0);

        setChatMessages(prev => {
          const updated = [...prev];
          if (updated.length > 0) {
            const last = updated[updated.length - 1];
            if (last.role === "assistant") {
              last.content = fullText;
              last.reasoning = fullReasoning;
              last.thinkingDuration = currentThinkingDuration;
              if (webSources) {
                last.webSources = webSources;
              }
            }
          }
          return updated;
        });
      });
    } catch (err) {
      if (err.name === "AbortError") {
        setChatMessages(prev => {
          const updated = [...prev];
          if (updated.length > 0) {
            const last = updated[updated.length - 1];
            if (last.role === "assistant") {
              last.content += "\n\n[Генерация остановлена пользователем]";
            }
          }
          return updated;
        });
      } else {
        setChatMessages(prev => {
          const updated = [...prev];
          if (updated.length > 0) {
            const last = updated[updated.length - 1];
            if (last.role === "assistant") {
              last.content = `Ошибка: ${err.message || "Не удалось получить ответ."}`;
            }
          }
          return updated;
        });
      }
    } finally {
      setIsChatSending(false);
      abortControllerRef.current = null;
    }
  };

  const handleStopPlaygroundChat = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  if (selectedAgent === null && !isCreateMode) {
    return (
      <div className="agents-container" style={{ display: "flex", flex: 1, height: "100%", overflow: "hidden", background: "var(--md-sys-color-surface)", color: "var(--md-sys-color-on-surface)" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", opacity: 0.8, gap: "16px" }}>
          <Cpu size={64} className="color-primary" />
          <h3 style={{ margin: 0, fontWeight: "600" }}>Локальные AI Агенты</h3>
          <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--md-sys-color-outline)", textAlign: "center", maxWidth: "400px" }}>
            Выберите существующего агента в боковой панели или создайте нового для выполнения специализированных задач.
          </p>
          <button
            onClick={handleCreateNewAgent}
            style={{ padding: "12px 24px", borderRadius: "8px", background: "var(--md-sys-color-primary)", color: "var(--md-sys-color-on-primary)", border: "none", cursor: "pointer", fontWeight: "600", fontSize: "0.9rem", display: "flex", alignItems: "center", gap: "8px" }}
          >
            <Plus size={18} /> Создать Агента
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="agents-container" style={{ display: "flex", flex: 1, height: "100%", overflow: "hidden", background: "var(--md-sys-color-surface)", color: "var(--md-sys-color-on-surface)" }}>
      {/* Right Pane - Agent Customizer / Dashboard */}
      <div className="agent-details" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--border-color)", background: "var(--md-sys-color-surface-container-lowest)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
            <div>
              <h2 style={{ margin: "0 0 4px 0", fontSize: "1.3rem", fontWeight: "600" }}>{isCreateMode ? "Создание нового Агента" : name}</h2>
              <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--md-sys-color-outline)" }}>
                {isCreateMode ? "Настройте имя и системные инструкции для нового ИИ-помощника" : (description || "Конфигурация параметров локального AI агента")}
              </p>
            </div>
            {selectedAgent && (
              <button 
                onClick={handleDeleteAgent}
                style={{ background: "transparent", border: "none", color: "var(--md-sys-color-error)", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px", fontSize: "0.85rem" }}
              >
                <Trash2 size={16} /> Удалить агента
              </button>
            )}
          </div>

          {/* Sub-navigation tabs */}
          {!isCreateMode && (
            <div style={{ display: "flex", gap: "8px" }}>
              <button 
                className={`tab-btn ${activeSubTab === "settings" ? "active" : ""}`}
                onClick={() => setActiveSubTab("settings")}
                style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 16px", borderRadius: "20px", border: "none", cursor: "pointer", background: activeSubTab === "settings" ? "var(--md-sys-color-primary-container)" : "transparent", color: activeSubTab === "settings" ? "var(--md-sys-color-on-primary-container)" : "inherit", fontWeight: "500", fontSize: "0.85rem" }}
              >
                <Settings size={16} /> Настройки
              </button>
              <button 
                className={`tab-btn ${activeSubTab === "rag" ? "active" : ""}`}
                onClick={() => setActiveSubTab("rag")}
                style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 16px", borderRadius: "20px", border: "none", cursor: "pointer", background: activeSubTab === "rag" ? "var(--md-sys-color-primary-container)" : "transparent", color: activeSubTab === "rag" ? "var(--md-sys-color-on-primary-container)" : "inherit", fontWeight: "500", fontSize: "0.85rem" }}
              >
                <Database size={16} /> База знаний (RAG)
              </button>
              <button 
                className={`tab-btn ${activeSubTab === "jobs" ? "active" : ""}`}
                onClick={() => setActiveSubTab("jobs")}
                style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 16px", borderRadius: "20px", border: "none", cursor: "pointer", background: activeSubTab === "jobs" ? "var(--md-sys-color-primary-container)" : "transparent", color: activeSubTab === "jobs" ? "var(--md-sys-color-on-primary-container)" : "inherit", fontWeight: "500", fontSize: "0.85rem" }}
              >
                <Activity size={16} /> Фоновые задачи
              </button>
              <button 
                className={`tab-btn ${activeSubTab === "chat" ? "active" : ""}`}
                onClick={() => setActiveSubTab("chat")}
                style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 16px", borderRadius: "20px", border: "none", cursor: "pointer", background: activeSubTab === "chat" ? "var(--md-sys-color-primary-container)" : "transparent", color: activeSubTab === "chat" ? "var(--md-sys-color-on-primary-container)" : "inherit", fontWeight: "500", fontSize: "0.85rem" }}
              >
                <MessageSquare size={16} /> Чат
              </button>
            </div>
          )}
        </div>

        {/* Tab Contents */}
        <div style={{ flex: 1, overflowY: "auto", padding: "24px", boxSizing: "border-box" }}>
          
          {/* Settings Tab */}
          {activeSubTab === "settings" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "20px", maxWidth: "800px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "0.85rem", fontWeight: "600" }}>Имя агента</label>
                <input 
                  type="text" 
                  value={name} 
                  onChange={e => setName(e.target.value)} 
                  style={{ padding: "10px 14px", borderRadius: "8px", border: "1px solid var(--border-color)", background: "var(--md-sys-color-surface-container-high)", color: "var(--md-sys-color-on-surface)", fontSize: "0.9rem" }}
                  placeholder="Введите имя..." 
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "0.85rem", fontWeight: "600" }}>Описание</label>
                <input 
                  type="text" 
                  value={description} 
                  onChange={e => setDescription(e.target.value)} 
                  style={{ padding: "10px 14px", borderRadius: "8px", border: "1px solid var(--border-color)", background: "var(--md-sys-color-surface-container-high)", color: "var(--md-sys-color-on-surface)", fontSize: "0.9rem" }}
                  placeholder="Краткое описание функционала..." 
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "0.85rem", fontWeight: "600" }}>Системный промпт</label>
                <textarea 
                  value={systemPrompt} 
                  onChange={e => setSystemPrompt(e.target.value)} 
                  rows={8}
                  style={{ padding: "12px 14px", borderRadius: "8px", border: "1px solid var(--border-color)", background: "var(--md-sys-color-surface-container-high)", color: "var(--md-sys-color-on-surface)", fontSize: "0.9rem", resize: "vertical", fontFamily: "monospace" }}
                  placeholder="Инструкции о том, как агент должен мыслить, вести себя и отвечать..." 
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "0.85rem", fontWeight: "600" }}>Доступ к Базе Знаний (RAG)</label>
                <div style={{ display: "flex", gap: "16px", marginTop: "4px" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "0.9rem" }}>
                    <input 
                      type="radio" 
                      name="ragScope" 
                      value="personal" 
                      checked={ragScope === "personal"} 
                      onChange={() => setRagScope("personal")} 
                    />
                    Персональный RAG (только файлы этого Агента)
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "0.9rem" }}>
                    <input 
                      type="radio" 
                      name="ragScope" 
                      value="shared" 
                      checked={ragScope === "shared"} 
                      onChange={() => setRagScope("shared")} 
                    />
                    Общий RAG (файлы из общей базы знаний)
                  </label>
                </div>
              </div>

              <div style={{ display: "flex", gap: "12px" }}>
                <button 
                  onClick={handleSaveAgentSettings}
                  style={{ padding: "12px 24px", borderRadius: "8px", background: "var(--md-sys-color-primary)", color: "var(--md-sys-color-on-primary)", border: "none", cursor: "pointer", fontWeight: "600", fontSize: "0.9rem", width: "fit-content", marginTop: "12px", transition: "opacity 0.2s" }}
                >
                  {selectedAgent ? "Сохранить изменения" : "Создать агента"}
                </button>
                {isCreateMode && (
                  <button 
                    onClick={() => setIsCreateMode(false)}
                    style={{ padding: "12px 24px", borderRadius: "8px", background: "var(--md-sys-color-surface-container-highest)", color: "var(--md-sys-color-on-surface)", border: "1px solid var(--border-color)", cursor: "pointer", fontWeight: "600", fontSize: "0.9rem", width: "fit-content", marginTop: "12px", transition: "opacity 0.2s" }}
                  >
                    Отмена
                  </button>
                )}
              </div>
            </div>
          )}

          {/* RAG Tab */}
          {activeSubTab === "rag" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "24px", maxWidth: "800px" }}>
              <div style={{ padding: "16px", borderRadius: "8px", background: "var(--md-sys-color-surface-container-high)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <h4 style={{ margin: "0 0 4px 0", fontWeight: "600" }}>
                    База знаний: {ragScope === "shared" ? "Общий RAG" : "Личный RAG"}
                  </h4>
                  <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--md-sys-color-outline)" }}>
                    {ragScope === "shared"
                      ? "Файлы доступны всем агентам с общим RAG."
                      : "Файлы изолированы и доступны только текущему агенту."}
                  </p>
                </div>
                
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading || !selectedAgent}
                  style={{ padding: "10px 18px", borderRadius: "8px", background: "var(--md-sys-color-secondary)", color: "var(--md-sys-color-on-secondary)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: "8px", fontWeight: "600", fontSize: "0.85rem", opacity: isUploading ? 0.7 : 1 }}
                >
                  {isUploading ? (
                    <>
                      <Loader2 size={16} className="animate-spin" /> Обработка...
                    </>
                  ) : (
                    <>
                      <UploadCloud size={16} /> Загрузить файл
                    </>
                  )}
                </button>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileUpload} 
                  style={{ display: "none" }} 
                  accept=".pdf,.txt,.md"
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <h4 style={{ margin: "0 0 4px 0", fontWeight: "600" }}>Список проиндексированных файлов</h4>
                {ragFiles.length === 0 ? (
                  <div style={{ padding: "32px", textAlign: "center", background: "var(--md-sys-color-surface-container-low)", border: "1px dashed var(--border-color)", borderRadius: "8px", fontSize: "0.85rem", color: "var(--md-sys-color-outline)" }}>
                    Файлы базы знаний не загружены. Поддерживаются форматы: .pdf, .txt, .md
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {ragFiles.map(file => (
                      <div 
                        key={file.id} 
                        style={{ padding: "12px 16px", borderRadius: "8px", background: "var(--md-sys-color-surface-container-high)", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
                          <FileText size={20} className="color-primary" style={{ flexShrink: 0 }} />
                          <span style={{ fontSize: "0.9rem", fontWeight: "500", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {file.filename}
                          </span>
                        </div>
                        <button 
                          onClick={() => handleDeleteFile(file.id, file.filename)}
                          style={{ background: "transparent", border: "none", color: "var(--md-sys-color-error)", cursor: "pointer", padding: "6px" }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Background Jobs Tab */}
          {activeSubTab === "jobs" && (
            <div style={{ display: "flex", gap: "24px", height: "100%", minHeight: "450px" }}>
              
              {/* Left task panel */}
              <div style={{ width: "320px", display: "flex", flexDirection: "column", gap: "16px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <h4 style={{ margin: 0, fontWeight: "600" }}>Новая фоновая задача</h4>
                  <textarea
                    value={newTaskPrompt}
                    onChange={e => setNewTaskPrompt(e.target.value)}
                    placeholder="Напишите инструкцию или задачу для агента..."
                    rows={4}
                    style={{ padding: "10px 12px", borderRadius: "8px", border: "1px solid var(--border-color)", background: "var(--md-sys-color-surface-container-high)", color: "var(--md-sys-color-on-surface)", fontSize: "0.85rem", resize: "none" }}
                  />
                  <button
                    onClick={handleStartBackgroundJob}
                    disabled={isStartingJob || !newTaskPrompt.trim() || !selectedAgent}
                    style={{ padding: "10px", borderRadius: "8px", background: "var(--md-sys-color-primary)", color: "var(--md-sys-color-on-primary)", border: "none", cursor: "pointer", fontWeight: "600", fontSize: "0.85rem", display: "flex", justifyContent: "center", alignItems: "center", gap: "8px" }}
                  >
                    <Play size={14} /> {isStartingJob ? "Запуск..." : "Запустить в фоне"}
                  </button>
                </div>

                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "8px", overflow: "hidden" }}>
                  <h4 style={{ margin: 0, fontWeight: "600" }}>История запусков</h4>
                  <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "8px" }}>
                    {jobs.length === 0 ? (
                      <div style={{ padding: "16px", textAlign: "center", fontSize: "0.8rem", color: "var(--md-sys-color-outline)" }}>
                        Нет запущенных задач.
                      </div>
                    ) : (
                      jobs.map(job => {
                        const isSelected = selectedJob?.id === job.id;
                        const statusColors = {
                          pending: { bg: "#f59e0b22", border: "#f59e0b88", text: "#f59e0b" },
                          running: { bg: "#3b82f622", border: "#3b82f688", text: "#3b82f6" },
                          completed: { bg: "#10b98122", border: "#10b98188", text: "#10b981" },
                          failed: { bg: "#ef444422", border: "#ef444488", text: "#ef4444" }
                        };
                        const status = statusColors[job.status] || { bg: "transparent", border: "gray", text: "gray" };

                        return (
                          <div
                            key={job.id}
                            onClick={() => viewJobDetails(job)}
                            style={{
                              padding: "10px 12px",
                              borderRadius: "8px",
                              background: isSelected ? "var(--md-sys-color-secondary-container)" : "var(--md-sys-color-surface-container-high)",
                              border: isSelected ? "1px solid var(--md-sys-color-outline-variant)" : "1px solid transparent",
                              cursor: "pointer",
                              display: "flex",
                              flexDirection: "column",
                              gap: "6px"
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <span 
                                style={{ 
                                  fontSize: "0.7rem", 
                                  fontWeight: "600", 
                                  padding: "2px 6px", 
                                  borderRadius: "10px", 
                                  background: status.bg, 
                                  border: `1px solid ${status.border}`, 
                                  color: status.text,
                                  textTransform: "uppercase"
                                }}
                              >
                                {job.status === "pending" ? "В очереди" : job.status === "running" ? "Работает" : job.status === "completed" ? "Готово" : "Ошибка"}
                              </span>
                              {job.status === "running" && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleStopJob(job.id); }}
                                  style={{ background: "transparent", border: "none", color: "var(--md-sys-color-error)", cursor: "pointer", display: "flex", padding: 0 }}
                                  title="Остановить выполнение"
                                >
                                  <StopCircle size={14} />
                                </button>
                              )}
                            </div>
                            <div style={{ fontSize: "0.8rem", fontWeight: "500", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {job.task_prompt}
                            </div>
                            <div style={{ fontSize: "0.68rem", opacity: 0.7 }}>
                              {new Date(job.created_at).toLocaleTimeString()} {new Date(job.created_at).toLocaleDateString()}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>

              {/* Right logs panel */}
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "8px", background: "var(--md-sys-color-surface-container-lowest)", border: "1px solid var(--border-color)", borderRadius: "8px", padding: "16px", boxSizing: "border-box" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", borderBottom: "1px solid var(--border-color)", paddingBottom: "10px" }}>
                  <Terminal size={18} />
                  <h4 style={{ margin: 0, fontWeight: "600" }}>Консоль выполнения</h4>
                </div>

                <div style={{ flex: 1, overflow: "auto", fontFamily: "monospace", fontSize: "0.8rem", background: "#0e1117", color: "#a9b1d6", padding: "12px", borderRadius: "6px", whiteSpace: "pre-wrap" }}>
                  {selectedJob ? jobLogs : "Выберите задачу в левом списке для просмотра логов работы."}
                </div>
              </div>

            </div>
          )}

          {/* Chat Tab */}
          {activeSubTab === "chat" && (
            <div style={{ display: "flex", flexDirection: "column", height: "550px", border: "1px solid var(--border-color)", borderRadius: "12px", overflow: "hidden", background: "var(--md-sys-color-surface-container-lowest)" }}>
              
              {/* Chat Header with Clear Button */}
              <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border-color)", background: "var(--md-sys-color-surface-container-low)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "0.85rem", fontWeight: "600", opacity: 0.8 }}>Тестирование и история Агента</span>
                <button
                  onClick={handleClearChatHistory}
                  style={{ background: "transparent", border: "none", color: "var(--md-sys-color-error)", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px", fontSize: "0.82rem", padding: "4px 8px", borderRadius: "4px" }}
                >
                  <Trash2 size={14} /> Очистить историю
                </button>
              </div>

              {/* Chat Message List */}
              <div 
                ref={chatMessagesRef}
                className="chat-messages"
                style={{ flex: 1, overflowY: "auto", padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}
              >
                {chatMessages.length === 0 ? (
                  <div className="chat-empty" style={{ margin: "auto", textAlign: "center", padding: "40px 20px" }}>
                    <div className="chat-empty-icon" style={{ display: "inline-flex", background: "var(--md-sys-color-primary-container)", color: "var(--md-sys-color-on-primary-container)", padding: "16px", borderRadius: "50%", marginBottom: "16px" }}>
                      <Cpu size={32} />
                    </div>
                    <h3 style={{ margin: "0 0 8px 0", fontWeight: "600", color: "var(--md-sys-color-on-surface)" }}>Чат с агентом {selectedAgent?.name}</h3>
                    <p style={{ margin: 0, fontSize: "0.88rem", color: "var(--md-sys-color-outline)", maxWidth: "360px", lineHeight: 1.5 }}>
                      Начните общение с вашим настроенным ИИ-агентом. Все сообщения будут сохранены в его памяти для обучения.
                    </p>
                  </div>
                ) : (
                  chatMessages.map((msg, idx) => {
                    // System notes (e.g. RAG upload confirmations) — rendered as a subtle centered label
                    if (msg.role === "system-note") {
                      return (
                        <div key={idx} style={{ textAlign: "center", padding: "6px 16px", margin: "4px 0" }}>
                          <span style={{ fontSize: "0.78rem", color: "var(--md-sys-color-outline)", background: "var(--md-sys-color-surface-container)", borderRadius: "12px", padding: "3px 12px", display: "inline-block" }}>
                            {msg.content}
                          </span>
                        </div>
                      );
                    }
                    const isUser = msg.role === "user";
                    const processed = processMessageContent(
                      msg.content || "",
                      msg.reasoning || "",
                      true
                    );
                    const displayContent = processed.content;
                    const displayReasoning = processed.reasoning;
                    const hasDisplayContent = displayContent && (
                      typeof displayContent === "string" 
                        ? Boolean(displayContent.trim())
                        : Array.isArray(displayContent) && displayContent.length > 0
                    );

                    return (
                      <div 
                        key={idx} 
                        className={`chat-message-row ${isUser ? "user" : "ai"}`}
                      >
                        <div className={`chat-avatar ${isUser ? "user" : "ai"}`}>
                          {isUser ? "Вы" : "ИИ"}
                        </div>
                        <div className="chat-bubble-wrap">
                          <span className="chat-sender-label">
                            {isUser ? "Вы" : (selectedAgent?.name || "Агент")}
                          </span>
                          {!isUser && displayReasoning && (
                            <ChatThinkingSection
                              reasoning={displayReasoning}
                              timeElapsed={msg.thinkingDuration}
                              isComplete={!isChatSending || idx < chatMessages.length - 1}
                            />
                          )}
                          {hasDisplayContent && (
                            <div className="chat-bubble">
                              {Array.isArray(displayContent) ? (
                                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                                  {displayContent.map((item, itemIdx) => {
                                    if (item.type === "text") return <MarkdownRenderer key={itemIdx} content={item.text} />;
                                    if (item.type === "image_url") return (
                                      <img 
                                        key={itemIdx} 
                                        src={item.image_url.url} 
                                        alt="Attached preview"
                                        style={{ maxWidth: "240px", maxHeight: "180px", objectFit: "contain", borderRadius: "8px", marginTop: "4px" }}
                                      />
                                    );
                                    return null;
                                  })}
                                </div>
                              ) : (
                                <MarkdownRenderer content={displayContent} />
                              )}
                            </div>
                          )}
                          {msg.role === "assistant" && Array.isArray(msg.webSources) && msg.webSources.length > 0 && (
                            <div style={{
                              marginTop: "8px",
                              display: "flex",
                              flexWrap: "wrap",
                              gap: "6px"
                            }}>
                              {msg.webSources.map((source, sourceIndex) => (
                                <a 
                                  key={sourceIndex}
                                  href={source.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="chat-web-source-pill"
                                  style={{
                                    fontSize: "0.75rem",
                                    padding: "4px 8px",
                                    borderRadius: "12px",
                                    background: "var(--md-sys-color-surface-container-high)",
                                    color: "var(--md-sys-color-primary)",
                                    border: "1px solid var(--border-color)",
                                    textDecoration: "none"
                                  }}
                                >
                                  [{source.index || sourceIndex + 1}] {source.title || source.url}
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Chat Input Bar */}
              <div className="chat-composer" style={{ borderTop: "1px solid var(--border-color)", background: "var(--md-sys-color-surface-container-low)" }}>
                <div className="chat-composer-inner">
                  <input 
                    type="file" 
                    ref={composerFileInputRef} 
                    multiple 
                    accept="image/jpeg,image/png,image/webp,.txt,.md,.csv,.js,.jsx,.ts,.tsx,.py,.json,.css,.html,.java,.cpp,.c,.h,.rs,.go,.sh,.bat,.xml,.yaml,.yml,.pdf"
                    onChange={handleComposerFileChange} 
                    style={{ display: "none" }} 
                  />

                  {attachments.length > 0 && (
                    <div className="chat-attachments" style={{ display: "flex", flexWrap: "wrap", gap: "8px", padding: "8px 12px", borderBottom: "1px solid var(--border-color)" }}>
                      {attachments.map(att => (
                        <div 
                          key={att.id} 
                          className="chat-attachment-pill"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "6px",
                            fontSize: "0.75rem",
                            padding: "4px 8px",
                            borderRadius: "6px",
                            background: "var(--md-sys-color-surface-container-high)",
                            border: "1px solid var(--border-color)",
                            color: "var(--md-sys-color-on-surface)"
                          }}
                        >
                          {att.type === "image" ? (
                            <img src={att.dataUrl} alt={att.name} style={{ width: "16px", height: "16px", objectFit: "cover", borderRadius: "3px" }} />
                          ) : (
                            <FileText size={13} className="color-primary" />
                          )}
                          <span style={{ maxWidth: "120px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{att.name}</span>
                          <button 
                            onClick={() => setAttachments(prev => prev.filter(a => a.id !== att.id))}
                            style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", display: "flex", color: "var(--md-sys-color-outline)" }}
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="chat-composer-textarea-container">
                    <textarea 
                      ref={textareaRef}
                      className="chat-composer-textarea"
                      value={chatInput} 
                      onChange={e => {
                        setChatInput(e.target.value);
                        resizeComposerInput();
                      }}
                      onKeyDown={e => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleSendPlaygroundChat();
                        }
                      }}
                      placeholder="Отправьте проверочное сообщение агенту... (Shift+Enter — новая строка)"
                      disabled={isChatSending && !abortControllerRef.current}
                      rows={1}
                      style={{ background: "transparent" }}
                    />
                  </div>
                  <div className="chat-composer-toolbar" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div className="chat-composer-toolbar-left" style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      <button 
                        className="chat-composer-tool-btn"
                        onClick={() => !isRagUploading && composerFileInputRef.current?.click()}
                        title={isRagUploading ? "Загрузка файла в RAG..." : "Прикрепить изображение или документ (авто-загрузка в RAG)"}
                        disabled={isRagUploading}
                        style={{ background: "transparent", border: "none", cursor: isRagUploading ? "wait" : "pointer", display: "flex", padding: "6px", borderRadius: "4px", color: isRagUploading ? "var(--md-sys-color-primary)" : "var(--md-sys-color-outline)", opacity: isRagUploading ? 0.7 : 1 }}
                      >
                        {isRagUploading ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> : <Paperclip size={16} />}
                      </button>
                      
                      <button 
                        className={`chat-composer-tool-btn ${useWebSearch ? "active" : ""}`}
                        onClick={() => setUseWebSearch(!useWebSearch)}
                        title="Поиск в Web"
                        style={{
                          background: "transparent",
                          border: "none",
                          cursor: "pointer",
                          display: "flex",
                          padding: "6px",
                          borderRadius: "4px",
                          color: useWebSearch ? "var(--md-sys-color-primary)" : "var(--md-sys-color-outline)"
                        }}
                      >
                        <Globe2 size={16} />
                      </button>

                      {supportsThinking && (
                        <label 
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                            cursor: "pointer",
                            fontSize: "0.75rem",
                            color: deepThinkEnabled ? "var(--md-sys-color-primary)" : "var(--md-sys-color-outline)",
                            marginLeft: "4px",
                            userSelect: "none"
                          }}
                        >
                          <input 
                            type="checkbox"
                            checked={deepThinkEnabled}
                            onChange={(e) => setDeepThinkEnabled(e.target.checked)}
                            style={{ margin: 0, width: "13px", height: "13px" }}
                          />
                          <span>Deep Think</span>
                        </label>
                      )}
                    </div>

                    <div className="chat-composer-toolbar-right">
                      {isChatSending ? (
                        <button 
                          className="chat-composer-stop-btn" 
                          onClick={handleStopPlaygroundChat}
                          title="Остановить генерацию"
                        >
                          <Square size={15} fill="currentColor" />
                        </button>
                      ) : (
                        <button 
                          className="chat-composer-send-btn" 
                          onClick={handleSendPlaygroundChat}
                          disabled={!chatInput.trim() && attachments.length === 0}
                          title="Отправить сообщение"
                        >
                          <Send size={17} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

            </div>
          )}

        </div>
      </div>
    </div>
  );
}
