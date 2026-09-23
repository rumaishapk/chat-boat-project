"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText } from "lucide-react";
import PdfUploader from "./components/PdfUploader";

type Message = {
  role: "ai" | "user";
  text: string;
  fileName?: string;
};

type Chat = {
  id: string | number;
  title: string;
  created_at: string;
};

type DbMessage = {
  id: string | number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

type ChatSubmit = {
  documentId?: string;
  message: string;
  fileName?: string;
};

const initialMessages: Message[] = [
  { role: "ai", text: "Hello! Where should we start?" },
  
];

const STREAM_WORD_DELAY_MS = 35;

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function splitIntoWordTokens(text: string) {
  return text.match(/\S+\s*/g) || [];
}

export default function Homepage() {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [messages]);

  const loadChats = useCallback(async () => {
    const response = await fetch("/api/chats");

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Failed to load chats:", response.status, errorText);
      return;
    }

    const data: { chats: Chat[] } = await response.json();
    setChats(data.chats);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadChats();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadChats]);

  const openChat = async (chatId: string) => {
    const response = await fetch(`/api/chats/${chatId}/messages`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Failed to open chat:", response.status, errorText);
      return;
    }

    const data: { messages: DbMessage[] } = await response.json();

    setActiveChatId(chatId);
    setActiveDocumentId(null);
    setMessages(
      data.messages.map((msg) => ({
        role: msg.role === "assistant" ? "ai" : "user",
        text: msg.content,
      })),
    );
  };

  const startNewChat = () => {
    setActiveChatId(null);
    setActiveDocumentId(null);
    setMessages(initialMessages);
    setInput("");
  };

  const sendChat = async ({ documentId, message, fileName }: ChatSubmit) => {
    const trimmedMessage = message.trim();
    const nextDocumentId = documentId || activeDocumentId;

    if (!trimmedMessage && !fileName) return;

    setIsSending(true);
    setMessages((current) => [
      ...current,
      {
        role: "user",
        text: trimmedMessage || "Uploaded a PDF.",
        fileName,
      },
    ]);
    setInput("");

    if (documentId) {
      setActiveDocumentId(documentId);
    }

    if (!trimmedMessage) {
      setMessages((current) => [
        ...current,
        {
          role: "ai",
          text: "PDF uploaded. Ask me what you want to know about it.",
        },
      ]);
      setIsSending(false);
      return;
    }

    try {
      const aiMessageIndex = messages.length + 1;

      setMessages((current) => [
        ...current,
        { role: "ai", text: "Thinking..." },
      ]);

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chatId: activeChatId,
          documentId: nextDocumentId,
          message: trimmedMessage,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Chat API failed:", response.status, errorText);
        throw new Error("Failed to stream response.");
      }

      if (!response.body) {
        throw new Error("No response body.");
      }

      const returnedChatId = response.headers.get("X-Chat-Id");

      if (returnedChatId) {
        setActiveChatId(returnedChatId);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let streamedText = "";

      const revealText = async (text: string) => {
        const tokens = splitIntoWordTokens(text);

        for (const token of tokens) {
          streamedText += token;

          setMessages((current) => {
            const updated = [...current];
            const aiMessage = updated[aiMessageIndex];

            if (aiMessage?.role === "ai") {
              updated[aiMessageIndex] = {
                ...aiMessage,
                text: streamedText,
              };
            }

            return updated;
          });

          await sleep(STREAM_WORD_DELAY_MS);
        }
      };

      while (true) {
        const { value, done } = await reader.read();

        if (done) {
          const remainingText = decoder.decode();

          if (remainingText) {
            await revealText(remainingText);
          }

          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        await revealText(chunk);
      }

      await loadChats();
    } catch (error) {
      console.error("Error:", error);
      setMessages((current) => {
        const updated = [...current];
        const lastMessage = updated[updated.length - 1];

        if (lastMessage?.role === "ai") {
          updated[updated.length - 1] = {
            ...lastMessage,
            text: "Something went wrong while sending your message.",
          };

          return updated;
        }

        return [
          ...current,
          {
            role: "ai",
            text: "Something went wrong while sending your message.",
          },
        ];
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="flex h-screen bg-[#212121] text-white">
      <div className="flex w-64 shrink-0 flex-col bg-[#171717] p-4">
        <button
          onClick={startNewChat}
          className="w-full rounded-md border border-gray-600 p-2 text-sm hover:bg-gray-800"
          type="button"
        >
          + New Chat
        </button>

        <div className="mt-4 flex-1 space-y-2 overflow-y-auto">
          {chats.map((chat) => {
            const chatId = String(chat.id);

            return (
              <button
                key={chatId}
                onClick={() => openChat(chatId)}
                className={`w-full truncate rounded-md px-3 py-2 text-left text-sm hover:bg-gray-800 ${
                  activeChatId === chatId ? "bg-gray-800" : ""
                }`}
                type="button"
              >
                {chat.title || "Untitled chat"}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <div className="mx-auto max-w-2xl">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`mb-2 rounded-lg p-4 ${
                  msg.role === "user" ? "bg-[#2f2f2f]" : "bg-transparent"
                }`}
              >
                <p className="mb-1 text-xs font-bold uppercase text-gray-400">
                  {msg.role === "user" ? "You" : "ChatBoat"}
                </p>
                {msg.fileName ? (
                  <div className="mb-3 inline-flex max-w-full items-center gap-2 rounded-lg border border-white/10 bg-[#3a3a3a] px-3 py-2 text-sm text-gray-100">
                    <FileText className="h-4 w-4 shrink-0" />
                    <span className="truncate">{msg.fileName}</span>
                  </div>
                ) : null}
                <p className="whitespace-pre-wrap text-gray-200">{msg.text}</p>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </div>

        <div className="p-6">
          <PdfUploader
            disabled={isSending}
            value={input}
            onChange={setInput}
            onSubmit={sendChat}
          />
        </div>
      </div>
    </div>
  );
}
