import React, { useEffect, useState } from "react";
import OpenAI from "openai";
import { z } from "zod";

// -----------------------------
// OPENAI CLIENT
// -----------------------------
const openai = new OpenAI({
  apiKey: import.meta.env.VITE_OPENAI_API_KEY,
  dangerouslyAllowBrowser: true,
});

// -----------------------------
// TYPES & VALIDATION
// -----------------------------
const ListingSchema = z.object({
  propertyType: z.string().min(1),
  address: z.string().optional(),
  price: z.string().optional(),
  beds: z.string().optional(),
  baths: z.string().optional(),
  sqft: z.string().optional(),
  lotSize: z.string().optional(),
  yearBuilt: z.string().optional(),
  parking: z.string().optional(),
  neighborhood: z.string().optional(),
  highlights: z.string().min(3),
  tone: z.enum(["standard", "luxury", "investor", "casual", "hype", "simple"]),
  length: z.enum(["short", "medium", "long"]),
  language: z.enum(["en", "es"]),
});

type ListingFormState = z.infer<typeof ListingSchema>;

type ListingOutputs = {
  heading: string;
  mls: string;
  zillow: string;
  social: string;
  email: string;
  tiktok: string;
};

type HistoryItem = {
  id: string;
  createdAt: string;
  form: ListingFormState;
  outputs: ListingOutputs;
  favorite: boolean;
};

const toneMap: Record<ListingFormState["tone"], string> = {
  standard: "professional, neutral real estate tone",
  luxury: "high-end, premium, aspirational luxury tone",
  investor: "ROI-focused, cash-flow oriented, investor analysis style",
  casual: "friendly, approachable, conversational tone",
  hype: "energetic, modern, attention-grabbing tone",
  simple: "easy-to-read, clear, simple tone",
};

const lengthMap: Record<ListingFormState["length"], string> = {
  short: "40–70 words",
  medium: "120–180 words",
  long: "220–300 words",
};

const HISTORY_KEY = "luxlist-history-v1";
const HISTORY_LIMIT = 50;

// -----------------------------
// HELPERS
// -----------------------------
const formatDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const formatPrice = (value?: string) => {
  if (!value) return "No price";
  const cleaned = value.replace(/[^0-9.]/g, "");
  const num = Number(cleaned);
  if (Number.isNaN(num)) return value;
  return num.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
};

// -----------------------------
// MAIN APP
// -----------------------------
export default function App() {
  const [loading, setLoading] = useState(false);
  const [rewriteLoadingKey, setRewriteLoadingKey] = useState<string | null>(
    null
  );
  const [output, setOutput] = useState<ListingOutputs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const [form, setForm] = useState<ListingFormState>({
    propertyType: "",
    address: "",
    price: "",
    beds: "",
    baths: "",
    sqft: "",
    lotSize: "",
    yearBuilt: "",
    parking: "",
    neighborhood: "",
    highlights: "",
    tone: "luxury",
    length: "medium",
    language: "en",
  });

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(
    null
  );

  // -----------------------------
  // HISTORY: load/save localStorage
  // -----------------------------
  useEffect(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (!raw) return;
      const parsed: HistoryItem[] = JSON.parse(raw);
      setHistory(parsed);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch {
      // ignore
    }
  }, [history]);

  const change = (
    e:
      | React.ChangeEvent<HTMLInputElement>
      | React.ChangeEvent<HTMLTextAreaElement>
      | React.ChangeEvent<HTMLSelectElement>
  ) =>
    setForm((p) => ({
      ...p,
      [e.target.name]: e.target.value,
    }));

  // -----------------------------
  // HISTORY HELPERS
  // -----------------------------
  const addToHistory = (formData: ListingFormState, outputs: ListingOutputs) => {
    const id =
      (crypto?.randomUUID?.() ?? Date.now().toString()) +
      "-" +
      Math.random().toString(16).slice(2);

    const item: HistoryItem = {
      id,
      createdAt: new Date().toISOString(),
      form: formData,
      outputs,
      favorite: false,
    };

    setHistory((prev) => {
      const updated = [item, ...prev];
      if (updated.length > HISTORY_LIMIT) {
        return updated.slice(0, HISTORY_LIMIT);
      }
      return updated;
    });
    setSelectedHistoryId(id);
  };

  const toggleFavorite = (id: string) => {
    setHistory((prev) =>
      prev.map((h) => (h.id === id ? { ...h, favorite: !h.favorite } : h))
    );
  };

  const loadFromHistory = (item: HistoryItem) => {
    setForm(item.form);
    setOutput(item.outputs);
    setSelectedHistoryId(item.id);
  };

  const deleteFromHistory = (id: string) => {
    setHistory((prev) => prev.filter((h) => h.id !== id));
    if (selectedHistoryId === id) {
      setSelectedHistoryId(null);
      setOutput(null);
    }
  };

  // -----------------------------
  // COPY HELPERS
  // -----------------------------
  const copyToClipboard = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
    } catch (e) {
      console.error("Copy failed", e);
      setError("Could not copy to clipboard.");
    }
  };

  // -----------------------------
  // GENERATE LISTING
  // -----------------------------
  const generate = async () => {
    setLoading(true);
    setOutput(null);
    setError(null);

    const parsed = ListingSchema.safeParse(form);
    if (!parsed.success) {
      setError("❌ Fill required fields correctly (Property Type & Highlights).");
      setLoading(false);
      return;
    }

    const data = parsed.data;
    const lang = data.language === "es" ? "Spanish" : "English";

    const details = `
Property Type: ${data.propertyType}
Address: ${data.address || "N/A"}
Price: ${data.price || "N/A"}
Beds: ${data.beds || "N/A"}
Baths: ${data.baths || "N/A"}
SqFt: ${data.sqft || "N/A"}
Lot Size: ${data.lotSize || "N/A"}
Year Built: ${data.yearBuilt || "N/A"}
Parking: ${data.parking || "N/A"}
Neighborhood: ${data.neighborhood || "N/A"}
Highlights: ${data.highlights}
`.trim();

    const prompt = `
You are a senior real estate listing copywriter with 20+ years experience.
You ONLY write text descriptions (NOT links, NOT MLS numbers, NOT emails).
You ALWAYS follow Fair Housing laws.

Write FIVE versions of listing copy for the following property, using the details provided.

Return your response as JSON with ONLY these keys:
"heading", "mls", "zillow", "social", "email", "tiktok".

### THE PURPOSE OF EACH FIELD:

heading:
- A short luxury-style headline (4–8 words)
- No emojis

mls:
- Professional MLS-style paragraph
- 120–160 words
- Full property description
- Include layout, features, materials, upgrades, PARKING, LOT SIZE, and YEAR BUILT where provided
- NO links, NO MLS numbers, NO contact info

zillow:
- Friendly, lifestyle-focused description
- 100–140 words
- More emotional, less formal
- Include some lifestyle context (near parks, schools, shopping) when provided
- NO links

social:
- Instagram-style caption
- 1–3 sentences
- Add 5–8 luxury real estate hashtags
- MAX 2 emojis
- NO links

email:
- Professional summary paragraph
- 60–100 words
- Written as if an agent is describing the home via email
- NO email addresses

tiktok:
- Hook + 4–6 bullet points + call-to-action
- MAX 2 emojis total
- NO TikTok links
- NO user handles
- Short, punchy, and high-energy

### PROPERTY DETAILS:
${details}
`.trim();

    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are a top-tier real estate listing copywriter. You ALWAYS follow Fair Housing rules and never reference protected classes.",
          },
          { role: "user", content: prompt },
        ],
      });

      const json = JSON.parse(
        completion.choices[0].message.content || "{}"
      ) as ListingOutputs;

      setOutput(json);
      addToHistory(data, json);
    } catch (e: any) {
      console.error(e);
      setError("OpenAI Error: " + e.message);
    }

    setLoading(false);
  };

  // -----------------------------
  // REWRITE SECTION
  // -----------------------------
  const rewriteSection = async (
    field: keyof ListingOutputs,
    instruction: string
  ) => {
    if (!output) return;
    const current = output[field];
    if (!current) return;

    setRewriteLoadingKey(`${field}:${instruction}`);
    setError(null);

    const prompt = `
You are a senior real estate copywriter.
Rewrite the existing ${field} text below according to the instruction.

Instruction: ${instruction}

Return JSON with ONLY this key: "${field}".

Existing text:
"""${current}"""
`.trim();

    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are an expert at rewriting real estate marketing copy while preserving key details and Fair Housing compliance.",
          },
          { role: "user", content: prompt },
        ],
      });

      const json = JSON.parse(completion.choices[0].message.content || "{}");
      const newFieldText = json[field];

      if (!newFieldText) {
        throw new Error("Model did not return rewritten field.");
      }

      setOutput((prev) =>
        prev ? { ...prev, [field]: newFieldText } : prev
      );

      if (selectedHistoryId) {
        setHistory((prev) =>
          prev.map((h) =>
            h.id === selectedHistoryId
              ? {
                  ...h,
                  outputs: {
                    ...h.outputs,
                    [field]: newFieldText,
                  },
                }
              : h
          )
        );
      }
    } catch (e: any) {
      console.error(e);
      setError("Rewrite error: " + e.message);
    }

    setRewriteLoadingKey(null);
  };

  const isBusy = loading || !!rewriteLoadingKey;

  // -----------------------------
  // UI
  // -----------------------------
  return (
    <main className="min-h-screen bg-[#070707] text-[#F5F5F5] px-4 md:px-6 py-8 md:py-10">
      <div className="max-w-6xl mx-auto grid gap-8 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        {/* LEFT PANEL - FORM */}
        <section className="bg-[#0D0D0D] border border-[#1F1F1F] rounded-2xl p-5 md:p-6 shadow-xl shadow-black/40">
          <h1 className="text-3xl font-bold text-[#F4C96B] mb-1">LuxList AI</h1>
          <p className="text-[#A0A0A0] text-sm mb-5">
            Generate luxury-grade real-estate listing descriptions in seconds.
          </p>

          <div className="space-y-4">
            {[
              "propertyType",
              "address",
              "price",
              "beds",
              "baths",
              "sqft",
              "lotSize",
              "yearBuilt",
              "parking",
              "neighborhood",
            ].map((f) => (
              <div key={f}>
                <label className="text-xs uppercase text-[#A0A0A0]">
                  {f.replace(/([A-Z])/g, " $1")}
                </label>
                <input
                  name={f}
                  value={(form as any)[f]}
                  onChange={change}
                  className="w-full bg-[#070707] border border-[#2A2A2A] rounded-lg px-3 py-2 mt-1 text-sm focus:border-[#F4C96B] outline-none"
                />
              </div>
            ))}

            <div>
              <label className="text-xs uppercase text-[#A0A0A0]">
                Highlights *
              </label>
              <textarea
                name="highlights"
                value={form.highlights}
                onChange={change}
                rows={4}
                className="w-full bg-[#070707] border border-[#2A2A2A] rounded-lg px-3 py-2 mt-1 text-sm focus:border-[#F4C96B] outline-none"
              />
            </div>

            {/* DROPDOWNS */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs uppercase text-[#A0A0A0]">Tone</label>
                <select
                  name="tone"
                  value={form.tone}
                  onChange={change}
                  className="w-full bg-[#070707] border border-[#2A2A2A] p-2 mt-1 rounded-lg text-sm focus:border-[#F4C96B] outline-none"
                >
                  <option value="luxury">Luxury</option>
                  <option value="standard">Standard</option>
                  <option value="investor">Investor</option>
                  <option value="casual">Casual</option>
                  <option value="hype">Hype</option>
                  <option value="simple">Simple</option>
                </select>
              </div>

              <div>
                <label className="text-xs uppercase text-[#A0A0A0]">
                  Length
                </label>
                <select
                  name="length"
                  value={form.length}
                  onChange={change}
                  className="w-full bg-[#070707] border border-[#2A2A2A] p-2 mt-1 rounded-lg text-sm focus:border-[#F4C96B] outline-none"
                >
                  <option value="short">Short</option>
                  <option value="medium">Medium</option>
                  <option value="long">Long</option>
                </select>
              </div>

              <div>
                <label className="text-xs uppercase text-[#A0A0A0]">
                  Language
                </label>
                <select
                  name="language"
                  value={form.language}
                  onChange={change}
                  className="w-full bg-[#070707] border border-[#2A2A2A] p-2 mt-1 rounded-lg text-sm focus:border-[#F4C96B] outline-none"
                >
                  <option value="en">English</option>
                  <option value="es">Spanish</option>
                </select>
              </div>
            </div>

            <button
              type="button"
              onClick={generate}
              disabled={isBusy}
              className="w-full bg-[#F4C96B] text-black font-semibold py-2.5 rounded-lg mt-2 text-sm hover:bg-[#FFE19B] transition shadow-lg shadow-amber-400/10 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? "Generating..." : "Generate Listing"}
            </button>

            {error && <p className="text-red-400 text-sm mt-1">{error}</p>}
          </div>
        </section>

        {/* RIGHT PANEL - HISTORY + OUTPUT */}
        <section className="bg-[#0D0D0D] border border-[#1F1F1F] rounded-2xl p-5 md:p-6 shadow-xl shadow-black/40 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-[#F4C96B]">
              Output & History
            </h2>
            <span className="text-xs text-[#A0A0A0]">
              Recent listings: {history.length}
            </span>
          </div>

          {/* History list */}
          <div className="max-h-40 overflow-auto border border-[#1F1F1F] rounded-xl bg-[#070707]/60 mb-2">
            {history.length === 0 ? (
              <p className="text-xs text-[#A0A0A0] px-3 py-2">
                No history yet. Generate a listing to save it here.
              </p>
            ) : (
              <ul className="divide-y divide-[#1F1F1F]">
                {history.map((item) => (
                  <li
                    key={item.id}
                    className={`px-3 py-2 text-xs flex items-center gap-2 cursor-pointer hover:bg-white/5 ${
                      selectedHistoryId === item.id ? "bg-white/10" : ""
                    }`}
                    onClick={() => loadFromHistory(item)}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFavorite(item.id);
                      }}
                      className="text-[#F4C96B] hover:text-[#FFE19B]"
                      title={item.favorite ? "Unstar" : "Star"}
                    >
                      {item.favorite ? "★" : "☆"}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">
                        {item.outputs.heading || "Untitled listing"}
                      </div>
                      <div className="text-[10px] text-[#A0A0A0] truncate">
                        {item.form.address || "No address"} •{" "}
                        {item.form.price
                          ? formatPrice(item.form.price)
                          : "No price"}{" "}
                        • {formatDate(item.createdAt)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteFromHistory(item.id);
                      }}
                      className="text-[#A0A0A0] hover:text-red-400 text-xs"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Output */}
          <div className="flex-1 overflow-auto space-y-4 text-sm">
            {!output && (
              <p className="text-[#A0A0A0] text-sm">
                Fill the form and click{" "}
                <span className="font-semibold text-[#F5F5F5]">Generate</span>{" "}
                or select a listing from history.
              </p>
            )}

            {output && (
              <>
                {/* Heading */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="text-[#F4C96B] font-semibold uppercase">
                      Heading
                    </h3>
                    <button
                      type="button"
                      onClick={() =>
                        copyToClipboard("heading", output.heading)
                      }
                      className="text-[11px] px-2 py-1 rounded border border-[#2A2A2A] hover:border-[#F4C96B] text-[#A0A0A0]"
                    >
                      {copiedKey === "heading" ? "Copied ✓" : "Copy"}
                    </button>
                  </div>
                  <textarea
                    readOnly
                    value={output.heading}
                    className="w-full h-16 bg-[#070707] border border-[#2A2A2A] rounded-lg p-3 text-xs"
                  />
                </div>

                {/* MLS */}
                <div>
                  <div className="flex items-center justify-between mb-1 gap-2">
                    <h3 className="text-[#F4C96B] font-semibold uppercase">
                      MLS
                    </h3>
                    <div className="flex items-center gap-1 flex-wrap justify-end">
                      <button
                        type="button"
                        onClick={() => copyToClipboard("mls", output.mls)}
                        className="text-[11px] px-2 py-1 rounded border border-[#2A2A2A] hover:border-[#F4C96B] text-[#A0A0A0]"
                      >
                        {copiedKey === "mls" ? "Copied ✓" : "Copy"}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          rewriteSection(
                            "mls",
                            "Make this shorter while keeping key details."
                          )
                        }
                        disabled={rewriteLoadingKey?.startsWith("mls:") || loading}
                        className="text-[11px] px-2 py-1 rounded border border-[#2A2A2A] hover:border-[#F4C96B] text-[#A0A0A0] disabled:opacity-50"
                      >
                        Shorter
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          rewriteSection(
                            "mls",
                            "Make this slightly longer and more descriptive."
                          )
                        }
                        disabled={rewriteLoadingKey?.startsWith("mls:") || loading}
                        className="text-[11px] px-2 py-1 rounded border border-[#2A2A2A] hover:border-[#F4C96B] text-[#A0A0A0] disabled:opacity-50"
                      >
                        Longer
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          rewriteSection(
                            "mls",
                            "Make this feel more luxury and high-end without adding fluff."
                          )
                        }
                        disabled={rewriteLoadingKey?.startsWith("mls:") || loading}
                        className="text-[11px] px-2 py-1 rounded border border-[#2A2A2A] hover:border-[#F4C96B] text-[#A0A0A0] disabled:opacity-50"
                      >
                        More Luxury
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          rewriteSection(
                            "mls",
                            "Make the tone slightly more casual and conversational."
                          )
                        }
                        disabled={rewriteLoadingKey?.startsWith("mls:") || loading}
                        className="text-[11px] px-2 py-1 rounded border border-[#2A2A2A] hover:border-[#F4C96B] text-[#A0A0A0] disabled:opacity-50"
                      >
                        More Casual
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          rewriteSection(
                            "mls",
                            "Make this more appealing to investors while staying compliant."
                          )
                        }
                        disabled={rewriteLoadingKey?.startsWith("mls:") || loading}
                        className="text-[11px] px-2 py-1 rounded border border-[#2A2A2A] hover:border-[#F4C96B] text-[#A0A0A0] disabled:opacity-50"
                      >
                        Investor
                      </button>
                    </div>
                  </div>
                  {rewriteLoadingKey?.startsWith("mls:") && (
                    <p className="text-[11px] text-[#A0A0A0] mb-1">
                      Rewriting MLS…
                    </p>
                  )}
                  <textarea
                    readOnly
                    value={output.mls}
                    className="w-full h-28 bg-[#070707] border border-[#2A2A2A] rounded-lg p-3 text-xs"
                  />
                </div>

                {/* Zillow */}
                <div>
                  <div className="flex items-center justify-between mb-1 gap-2">
                    <h3 className="text-[#F4C96B] font-semibold uppercase">
                      Zillow / Portal
                    </h3>
                  <div className="flex gap-1 flex-wrap justify-end">
                      <button
                        type="button"
                        onClick={() =>
                          copyToClipboard("zillow", output.zillow)
                        }
                        className="text-[11px] px-2 py-1 rounded border border-[#2A2A2A] hover:border-[#F4C96B] text-[#A0A0A0]"
                      >
                        {copiedKey === "zillow" ? "Copied ✓" : "Copy"}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          rewriteSection(
                            "zillow",
                            "Make this slightly more lifestyle-focused and emotional."
                          )
                        }
                        disabled={rewriteLoadingKey?.startsWith("zillow:") || loading}
                        className="text-[11px] px-2 py-1 rounded border border-[#2A2A2A] hover:border-[#F4C96B] text-[#A0A0A0] disabled:opacity-50"
                      >
                        More Lifestyle
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          rewriteSection(
                            "zillow",
                            "Tighten this up and make it a bit shorter."
                          )
                        }
                        disabled={rewriteLoadingKey?.startsWith("zillow:") || loading}
                        className="text-[11px] px-2 py-1 rounded border border-[#2A2A2A] hover:border-[#F4C96B] text-[#A0A0A0] disabled:opacity-50"
                      >
                        Shorter
                      </button>
                    </div>
                  </div>
                  {rewriteLoadingKey?.startsWith("zillow:") && (
                    <p className="text-[11px] text-[#A0A0A0] mb-1">
                      Rewriting Zillow description…
                    </p>
                  )}
                  <textarea
                    readOnly
                    value={output.zillow}
                    className="w-full h-28 bg-[#070707] border border-[#2A2A2A] rounded-lg p-3 text-xs"
                  />
                </div>

                {/* Social */}
                <div>
                  <div className="flex items-center justify-between mb-1 gap-2">
                    <h3 className="text-[#F4C96B] font-semibold uppercase">
                      Social Caption
                    </h3>
                    <div className="flex gap-1 flex-wrap justify-end">
                      <button
                        type="button"
                        onClick={() =>
                          copyToClipboard("social", output.social)
                        }
                        className="text-[11px] px-2 py-1 rounded border border-[#2A2A2A] hover:border-[#F4C96B] text-[#A0A0A0]"
                      >
                        {copiedKey === "social" ? "Copied ✓" : "Copy"}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          rewriteSection(
                            "social",
                            "Punch this up with a stronger hook and more scroll-stopping language, but no extra emojis."
                          )
                        }
                        disabled={rewriteLoadingKey?.startsWith("social:") || loading}
                        className="text-[11px] px-2 py-1 rounded border border-[#2A2A2A] hover:border-[#F4C96B] text-[#A0A0A0] disabled:opacity-50"
                      >
                        Stronger Hook
                      </button>
                    </div>
                  </div>
                  {rewriteLoadingKey?.startsWith("social:") && (
                    <p className="text-[11px] text-[#A0A0A0] mb-1">
                      Rewriting social caption…
                    </p>
                  )}
                  <textarea
                    readOnly
                    value={output.social}
                    className="w-full h-24 bg-[#070707] border border-[#2A2A2A] rounded-lg p-3 text-xs"
                  />
                </div>

                {/* Email */}
                <div>
                  <div className="flex items-center justify-between mb-1 gap-2">
                    <h3 className="text-[#F4C96B] font-semibold uppercase">
                      Email Version
                    </h3>
                    <div className="flex gap-1 flex-wrap justify-end">
                      <button
                        type="button"
                        onClick={() =>
                          copyToClipboard("email", output.email)
                        }
                        className="text-[11px] px-2 py-1 rounded border border-[#2A2A2A] hover:border-[#F4C96B] text-[#A0A0A0]"
                      >
                        {copiedKey === "email" ? "Copied ✓" : "Copy"}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          rewriteSection(
                            "email",
                            "Make this slightly more concise and direct while remaining professional."
                          )
                        }
                        disabled={rewriteLoadingKey?.startsWith("email:") || loading}
                        className="text-[11px] px-2 py-1 rounded border border-[#2A2A2A] hover:border-[#F4C96B] text-[#A0A0A0] disabled:opacity-50"
                      >
                        Tighter
                      </button>
                    </div>
                  </div>
                  {rewriteLoadingKey?.startsWith("email:") && (
                    <p className="text-[11px] text-[#A0A0A0] mb-1">
                      Rewriting email text…
                    </p>
                  )}
                  <textarea
                    readOnly
                    value={output.email}
                    className="w-full h-24 bg-[#070707] border border-[#2A2A2A] rounded-lg p-3 text-xs"
                  />
                </div>

                {/* TikTok */}
                <div>
                  <div className="flex items-center justify-between mb-1 gap-2">
                    <h3 className="text-[#F4C96B] font-semibold uppercase">
                      TikTok Script
                    </h3>
                    <div className="flex gap-1 flex-wrap justify-end">
                      <button
                        type="button"
                        onClick={() =>
                          copyToClipboard("tiktok", output.tiktok)
                        }
                        className="text-[11px] px-2 py-1 rounded border border-[#2A2A2A] hover:border-[#F4C96B] text-[#A0A0A0]"
                      >
                        {copiedKey === "tiktok" ? "Copied ✓" : "Copy"}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          rewriteSection(
                            "tiktok",
                            "Make this punchier and more hook-driven for a 20–30 second real estate TikTok."
                          )
                        }
                        disabled={rewriteLoadingKey?.startsWith("tiktok:") || loading}
                        className="text-[11px] px-2 py-1 rounded border border-[#2A2A2A] hover:border-[#F4C96B] text-[#A0A0A0] disabled:opacity-50"
                      >
                        More Punch
                      </button>
                    </div>
                  </div>
                  {rewriteLoadingKey?.startsWith("tiktok:") && (
                    <p className="text-[11px] text-[#A0A0A0] mb-1">
                      Rewriting TikTok script…
                    </p>
                  )}
                  <textarea
                    readOnly
                    value={output.tiktok}
                    className="w-full h-24 bg-[#070707] border border-[#2A2A2A] rounded-lg p-3 text-xs"
                  />
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
