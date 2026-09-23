// Study bot — calls Groq's API directly from the browser.
// The API key lives ONLY in this browser's localStorage. It is never sent
// anywhere except https://api.groq.com, never written into any file in this
// repo, and never seen by anyone else who visits the published site.

const GROQ_KEY_STORAGE = "groq_api_key";
const GROQ_MODEL_STORAGE = "groq_model_choice";
let botHistory = [];

function getGroqKey() { return localStorage.getItem(GROQ_KEY_STORAGE) || ""; }
function setGroqKey(k) { localStorage.setItem(GROQ_KEY_STORAGE, k.trim()); }
function getModel() { return localStorage.getItem(GROQ_MODEL_STORAGE) || "llama-3.3-70b-versatile"; }
function setModel(m) { localStorage.setItem(GROQ_MODEL_STORAGE, m); }

function injectBotWidget() {
  const toggle = document.createElement("button");
  toggle.id = "bot-toggle";
  toggle.textContent = "AI";
  toggle.title = "Ask the study bot";
  document.body.appendChild(toggle);

  const panel = document.createElement("div");
  panel.id = "bot-panel";
  panel.innerHTML = `
    <div class="bot-head">
      <span>CS Study Bot</span>
      <button id="bot-settings-toggle" title="Settings">⚙</button>
      <button id="bot-close" title="Close">✕</button>
    </div>
    <div id="bot-body">
      <div class="bot-messages" id="bot-messages"></div>
      <div class="bot-select-row">
        Model:
        <select id="bot-model-select">
          <option value="llama-3.3-70b-versatile">Llama 3.3 70B (fast, default)</option>
          <option value="openai/gpt-oss-120b">GPT-OSS 120B (stronger reasoning)</option>
        </select>
      </div>
      <div class="bot-input-row">
        <input id="bot-input" type="text" placeholder="Ask about any topic..." />
        <button id="bot-send">Send</button>
      </div>
    </div>
    <div id="bot-settings-panel" class="bot-settings" style="display:none;">
      <p>Your Groq API key is stored only in this browser (localStorage). It's never sent anywhere except Groq's API, and it's never written into the site's code.</p>
      <input id="bot-key-input" type="password" placeholder="gsk_..." />
      <button id="bot-key-save">Save key</button>
      <p>Don't have one? Get a free key at <a href="https://console.groq.com/keys" target="_blank">console.groq.com/keys</a> — takes about 2 minutes, no card required.</p>
    </div>
  `;
  document.body.appendChild(panel);

  const messages = document.getElementById("bot-messages");
  const modelSelect = document.getElementById("bot-model-select");
  modelSelect.value = getModel();
  modelSelect.addEventListener("change", () => setModel(modelSelect.value));

  toggle.addEventListener("click", () => {
    panel.classList.toggle("open");
    if (panel.classList.contains("open") && !getGroqKey()) {
      showSettings(true);
    }
  });
  document.getElementById("bot-close").addEventListener("click", () => panel.classList.remove("open"));
  document.getElementById("bot-settings-toggle").addEventListener("click", () => {
    showSettings(document.getElementById("bot-settings-panel").style.display === "none");
  });

  function showSettings(show) {
    document.getElementById("bot-settings-panel").style.display = show ? "block" : "none";
    document.getElementById("bot-body").style.display = show ? "none" : "flex";
    document.getElementById("bot-body").style.flexDirection = "column";
    document.getElementById("bot-body").style.flex = "1";
  }
  showSettings(!getGroqKey());

  document.getElementById("bot-key-save").addEventListener("click", () => {
    const val = document.getElementById("bot-key-input").value;
    if (val.trim()) {
      setGroqKey(val);
      document.getElementById("bot-key-input").value = "";
      showSettings(false);
      addMessage("system", "Key saved to this browser. Ask away.");
    }
  });

  document.getElementById("bot-send").addEventListener("click", sendBotMessage);
  document.getElementById("bot-input").addEventListener("keydown", e => {
    if (e.key === "Enter") sendBotMessage();
  });

  if (botHistory.length === 0) {
    addMessage("system", "Ask me anything about your 3 subjects — I'll answer from general knowledge of Indian company/tax/securities law. Always cross-check exam-critical points against your official study material.");
  }
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Lightweight markdown renderer — handles the patterns Groq's models actually
// use in replies (bold, headings, bullet lists, horizontal rules, paragraphs).
function renderMarkdown(raw) {
  const lines = escapeHtml(raw).split("\n");
  let html = "";
  let inList = false;
  const closeList = () => { if (inList) { html += "</ul>"; inList = false; } };

  lines.forEach(line => {
    const trimmed = line.trim();
    if (trimmed === "" ) { closeList(); return; }
    if (/^-{3,}$/.test(trimmed)) { closeList(); html += "<hr>"; return; }
    const heading = trimmed.match(/^#{1,4}\s+(.*)$/);
    if (heading) { closeList(); html += `<h4>${inline(heading[1])}</h4>`; return; }
    const bullet = trimmed.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${inline(bullet[1])}</li>`;
      return;
    }
    closeList();
    html += `<p>${inline(trimmed)}</p>`;
  });
  closeList();
  return html;

  function inline(text) {
    return text
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`(.+?)`/g, "<code>$1</code>");
  }
}

function addMessage(role, text) {
  botHistory.push({ role, text });
  const messages = document.getElementById("bot-messages");
  const div = document.createElement("div");
  div.className = `bot-msg ${role}`;
  const bubble = document.createElement("span");
  bubble.className = "bubble";
  if (role === "assistant") {
    bubble.innerHTML = renderMarkdown(text);
  } else {
    bubble.textContent = text;
  }
  div.appendChild(bubble);
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

async function sendBotMessage() {
  const input = document.getElementById("bot-input");
  const text = input.value.trim();
  if (!text) return;
  const key = getGroqKey();
  if (!key) {
    document.getElementById("bot-settings-panel").style.display = "block";
    document.getElementById("bot-body").style.display = "none";
    return;
  }
  addMessage("user", text);
  input.value = "";
  addMessage("system", "Thinking...");
  const thinkingNode = document.getElementById("bot-messages").lastChild;

  try {
    const reply = await callGroq(key, text);
    thinkingNode.remove();
    botHistory.pop(); // remove the "Thinking..." placeholder from history
    addMessage("assistant", reply);
  } catch (err) {
    thinkingNode.remove();
    botHistory.pop();
    addMessage("system", `Error: ${err.message}. Check that your API key is correct in Settings (⚙).`);
  }
}

function openBotWithPrompt(promptText, paperId) {
  const panel = document.getElementById("bot-panel");
  panel.classList.add("open");
  if (!getGroqKey()) {
    document.getElementById("bot-settings-panel").style.display = "block";
    document.getElementById("bot-body").style.display = "none";
    return;
  }
  document.getElementById("bot-input").value = promptText;
  sendBotMessage();
}

async function callGroq(key, userText) {
  const systemPrompt = `You are a study assistant for a student preparing for the ICSI Company Secretary (CS) Executive Programme, Group 2 (Module 2): Paper 5 Capital Market & Securities Laws, Paper 6 Economic, Commercial & Intellectual Property Laws, Paper 7 Tax Laws & Practice. Answer clearly and concisely, structured for exam revision. If asked about a specific provision, section number, or recent amendment, note that the student should verify the exact current text against their official ICSI study material, since law can change after your knowledge cutoff.`;

  const messages = [
    { role: "system", content: systemPrompt },
    ...botHistory.filter(m => m.role !== "system").slice(-8).map(m => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.text
    })),
  ];

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: getModel(),
      messages,
      max_tokens: 700,
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody?.error?.message || `HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "No response received.";
}

document.addEventListener("DOMContentLoaded", injectBotWidget);
