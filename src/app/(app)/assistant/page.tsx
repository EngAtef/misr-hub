"use client";

import { useRef, useState, useEffect } from "react";
import Link from "next/link";
import { Sparkles, Send, ArrowLeft } from "lucide-react";
import { useLang } from "@/lib/i18n";

interface Msg {
  role: "user" | "assistant";
  text: string;
  table?: { columns: string[]; rows: (string | number)[][] };
  link?: string;
}

const SAMPLES = {
  ar: [
    "مبيعات هذا الشهر",
    "أعلى الكتب مبيعاً",
    "أي كتب محتاجة مخزون؟",
    "أداء الإعلانات",
    "تقدم الأهداف",
    "شرائح العملاء",
  ],
  en: [
    "Sales this month",
    "Top selling books",
    "Which books need stock?",
    "Ad performance",
    "Target progress",
    "Customer segments",
  ],
};

export default function AssistantPage() {
  const { t, lang } = useLang();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function ask(question: string) {
    if (!question.trim() || loading) return;
    setMessages((m) => [...m, { role: "user", text: question }]);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, lang }),
      });
      const data = await res.json();
      const text = data.answer?.[lang] ?? data.answer?.ar ?? t("error");
      setMessages((m) => [...m, { role: "assistant", text, table: data.table, link: data.link }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", text: t("error") }]);
    }
    setLoading(false);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white">
          <Sparkles size={20} />
        </div>
        <div>
          <h1 className="text-2xl font-bold">{t("assistant")}</h1>
          <p className="text-sm text-slate-500">{t("assistantSubtitle")}</p>
        </div>
      </div>

      <div className="card min-h-[55vh] flex flex-col">
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {messages.length === 0 && (
            <div className="space-y-4">
              <div className="rounded-2xl rounded-ss-sm bg-brand-50 px-4 py-3 text-sm text-slate-700 w-fit max-w-[85%]">
                {t("assistantWelcome")}
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-400 mb-2">{t("trySamples")}</div>
                <div className="flex flex-wrap gap-2">
                  {SAMPLES[lang].map((s) => (
                    <button
                      key={s}
                      onClick={() => ask(s)}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-brand-400 hover:text-brand-600"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
              <div
                className={
                  m.role === "user"
                    ? "rounded-2xl rounded-se-sm bg-brand-600 px-4 py-2.5 text-sm text-white max-w-[85%]"
                    : "rounded-2xl rounded-ss-sm bg-slate-100 px-4 py-3 text-sm text-slate-800 max-w-[92%] w-fit"
                }
              >
                <div className="whitespace-pre-wrap leading-relaxed">{m.text}</div>
                {m.table && (
                  <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
                    <table className="w-full text-xs">
                      <thead>
                        <tr>
                          {m.table.columns.map((c) => (
                            <th key={c} className="bg-slate-50 px-2.5 py-1.5 text-start font-semibold text-slate-500 whitespace-nowrap">{c}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {m.table.rows.map((row, ri) => (
                          <tr key={ri}>
                            {row.map((cell, ci) => (
                              <td key={ci} className="border-t border-slate-100 px-2.5 py-1.5 whitespace-nowrap">{cell}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {m.link && (
                  <Link href={m.link} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline">
                    <ArrowLeft size={13} className="rtl:rotate-180" />
                    {t("viewCustomers")}
                  </Link>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex gap-1.5 px-4 py-3 w-fit rounded-2xl bg-slate-100">
              <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.3s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.15s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400" />
            </div>
          )}
          <div ref={endRef} />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(input);
          }}
          className="flex items-center gap-2 border-t border-slate-200 p-3"
        >
          <input
            className="input"
            placeholder={t("askPlaceholder")}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button type="submit" className="btn-primary shrink-0" disabled={loading || !input.trim()}>
            <Send size={16} />
            {t("send")}
          </button>
        </form>
      </div>
    </div>
  );
}
