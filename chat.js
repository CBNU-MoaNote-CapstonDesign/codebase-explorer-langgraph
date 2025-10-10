const apiPrefix = "/api";

document.getElementById("sendBtn").addEventListener("click", sendMessage);
document.getElementById("resetBtn").addEventListener("click", resetConversation);
document.getElementById("userInput").addEventListener("keypress", (e) => {
  if (e.key === "Enter") sendMessage();
});

async function resetConversation() {
  try {
    const response = await fetch(apiPrefix + "/reset", { method: "POST" });
    const data = await response.json();

    // 화면 기록도 초기화
    document.getElementById("messages").innerHTML = "";
    addMessage("assistant", "🗑️ " + data.message);
  } catch (err) {
    addMessage("assistant", "⚠️ 대화 초기화 실패");
    console.error(err);
  }
}

async function sendMessage() {
  const input = document.getElementById("userInput");
  const userText = input.value.trim();
  if (!userText) return;

  addMessage("user", userText);
  input.value = "";

  try {
    const response = await fetch(apiPrefix + "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: userText }),
    });

    const data = await response.json();
    if (data.error) {
      addMessage("assistant", "❌ 오류: " + data.error);
      return;
    }

    addMessage("assistant", data.reply);
  } catch (err) {
    addMessage("assistant", "⚠️ 네트워크 오류 발생");
    console.error(err);
  }
}

function addMessage(role, text) {
  const messagesDiv = document.getElementById("messages");
  const msg = document.createElement("div");
  msg.className = "message " + role;
  msg.textContent = (role === "user" ? "👤 You: " : "🤖 Bot: ") + text;
  messagesDiv.appendChild(msg);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}