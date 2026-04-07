interface Message {
  role: "user" | "assistant";
  content: string;
}

export async function getExaminerResponse(messages: Message[]) {
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    });
    
    if (!response.ok) {
      throw new Error("Failed to get examiner response");
    }
    
    const data = await response.json();
    return data.content || "";
  } catch (error) {
    console.error("API Error:", error);
    return "I'm sorry, I'm having trouble connecting to the server. Could you please repeat that?";
  }
}
