
require("dotenv").config();

const express = require("express");
const path = require("path");
const { GoogleGenAI } = require("@google/genai");

const app = express();
const PORT = process.env.PORT || 3000;

const groqKey = process.env.GROQ_API_KEY;
const geminiKey = process.env.GEMINI_API_KEY;

if (!groqKey && !geminiKey) {
  console.error("GROQ_API_KEY ya GEMINI_API_KEY .env mein add karo.");
  process.exit(1);
}

const ai = geminiKey
  ? new GoogleGenAI({ apiKey: geminiKey })
  : null;

app.use(express.json({ limit: "10kb" }));
app.use(express.static(path.join(__dirname, "public")));

const allowedLanguages = {
  English: "simple, natural English",
  Hindi: "natural Hindi in Devanagari script",
  Gujarati: "natural Gujarati in Gujarati script",
  Hinglish: "natural Hindi-English Hinglish in Roman script",
};

const allowedAspects = new Set([
  "Ambience & atmosphere",
  "Lighting",
  "Cleanliness",
  "Store layout",
  "Display & presentation",
  "Staff behaviour",
  "Staff helpfulness",
  "Staff product knowledge",
  "Customer service",
  "Billing experience",
  "Clothing collection",
  "Footwear collection",
  "Variety & choices",
  "Latest trends",
  "Sizes & availability",
  "Product quality",
  "Price & value",
  "Offers & discounts",
  "Shopping comfort",
  "Ease of product selection",
  "Overall shopping experience",
]);

async function generateWithGroq(prompt) {
  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${groqKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-20b",
        messages: [
          {
            role: "system",
            content:
              "Write natural, honest customer review drafts. Never invent experiences, facts, or opinions.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.6,
        max_tokens: 110,
      }),
      signal: AbortSignal.timeout(10000),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.error?.message || `Groq API error: ${response.status}`
    );
  }

  const draft = data.choices?.[0]?.message?.content?.trim();

  if (!draft) {
    throw new Error("Groq returned an empty review.");
  }

  return draft;
}

async function generateWithGemini(prompt) {
  if (!ai) {
    throw new Error("Gemini backup key is not configured.");
  }

  const response = await ai.models.generateContent({
    model: "gemini-3.5-flash-lite",
    contents: prompt,
    config: {
      maxOutputTokens: 110,
      temperature: 0.6,
      thinkingConfig: { thinkingLevel: "minimal" },
    },
  });

  const draft = response.text?.trim();

  if (!draft) {
    throw new Error("Gemini returned an empty review.");
  }

  return draft;
}

app.post("/api/review", async (req, res) => {
  const startedAt = Date.now();

  const rating = Number(req.body.rating);
  const language = req.body.language || "English";
  const aspects = req.body.aspects;

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({
      error: "Please choose a rating from 1 to 5 stars.",
    });
  }

  if (!Object.hasOwn(allowedLanguages, language)) {
    return res.status(400).json({
      error: "Please choose a supported language.",
    });
  }

  if (
    !Array.isArray(aspects) ||
    aspects.length > 5 ||
    aspects.some(
      (aspect) =>
        typeof aspect !== "string" || !allowedAspects.has(aspect)
    ) ||
    new Set(aspects).size !== aspects.length
  ) {
    return res.status(400).json({
      error: "Please select up to 5 valid store experience options.",
    });
  }

  const selectedAspects =
    aspects.length > 0
      ? aspects.join(", ")
      : "No specific store aspects selected";

  const prompt = `
You are writing a Google review draft for Sqver Circle,
a retail store offering clothing and footwear.

Customer rating: ${rating} out of 5 stars.
Language: ${allowedLanguages[language]}.
Topics selected by the customer: ${selectedAspects}.

WRITING RULES:

1. Write around 30-40 words.
2. Sound like an ordinary customer writing naturally.
3. Use simple, everyday language.
4. Avoid marketing and advertisement-style writing.
5. Never use exaggerated phrases such as:
   "amazing", "outstanding", "best ever",
   "truly 5-star worthy" or "perfect".
6. Mention selected topics naturally, without listing them.
7. Selecting a topic does NOT mean the customer liked it.
   Do not invent positive or negative opinions about it.
8. Do not invent purchases, staff interactions, products,
   prices, offers or any other personal experience.
9. Respect the customer's selected star rating.
10. If no topics are selected, keep the review general.
11. Vary sentence structure. Avoid repetitive AI-style openings.
12. Return only the review draft. No title, quotation marks
    or explanations.

The result should feel like a short review written by a real
person, not a promotional message written by a business.
`;

  try {
    let draft;
    let provider;

    if (groqKey) {
      try {
        draft = await generateWithGroq(prompt);
        provider = "Groq";
      } catch (groqError) {
        console.error("Groq failed:", groqError.message);

        if (!geminiKey) {
          throw groqError;
        }

        draft = await generateWithGemini(prompt);
        provider = "Gemini backup";
      }
    } else {
      draft = await generateWithGemini(prompt);
      provider = "Gemini";
    }

    const duration = Date.now() - startedAt;

    console.log(
      `Review generated | Provider: ${provider} | Time: ${duration}ms`
    );

    res.json({
      draft,
      provider,
      durationMs: duration,
    });
  } catch (error) {
    console.error(
      `Review generation failed after ${Date.now() - startedAt}ms:`,
      error.message
    );

    res.status(500).json({
      error: "AI review generate nahi hua. Please try again.",
    });
  }
});


if (require.main === module) {
  app.listen(PORT, () => {
    console.log(
      `Sqver Circle Review System running at http://localhost:${PORT}`
    );
  });
}

module.exports = app;
