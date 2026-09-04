// App.js
// -----------------------------------------------------------------------------
// Lucy — Personal AI Memory Assistant
// Voice + Gemini + Local Memory
// -----------------------------------------------------------------------------

import "./global.css";

import React, { useEffect, useRef, useState } from "react";

import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
  Alert,
} from "react-native";

import {
  SafeAreaView,
  SafeAreaProvider,
} from "react-native-safe-area-context";

import { StatusBar } from "expo-status-bar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import * as Speech from "expo-speech";

import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";

// -----------------------------------------------------------------------------
// STORAGE
// -----------------------------------------------------------------------------

const STORAGE_KEYS = {
  LOGS: "lucy_logs",
  API_KEY: "lucy_api_key",
  PROVIDER: "lucy_provider",
  MODEL: "lucy_model",
};

// Gemini 2.5 Flash is currently a stable Gemini API model.
const DEFAULT_MODELS = {
  openai: "gpt-5-mini",
  gemini: "gemini-2.5-flash",
};

// -----------------------------------------------------------------------------
// HELPERS
// -----------------------------------------------------------------------------

function formatTime(date) {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isSameDay(isoString) {
  const date = new Date(isoString);
  const now = new Date();

  return (
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear()
  );
}

function cleanJsonResponse(text) {
  return text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
}

// -----------------------------------------------------------------------------
// PROMPTS
// -----------------------------------------------------------------------------

function buildPrompt(logs, query) {
  const now = new Date();

  const logLines =
    logs
      .map(
        (log) =>
          "- [" +
          formatTime(new Date(log.timestamp)) +
          "] " +
          log.text
      )
      .join("\n") || "(nothing logged yet today)";

  return (
    "You are Lucy, a strict personal memory assistant.\n\n" +
    "Current time: " +
    formatTime(now) +
    " on " +
    now.toDateString() +
    ".\n\n" +
    "Today's memory log:\n" +
    logLines +
    "\n\n" +
    "User question:\n" +
    query +
    "\n\n" +
    "Answer clearly and naturally. " +
    "Use only information available in the memory log. " +
    "If something is unknown, say that you do not have it recorded."
  );
}

function buildMemoryPrompt(text) {
  return `
You are Lucy, a personal memory assistant.

Analyze the user's statement.

Your job is to determine whether the statement contains something useful
to remember later.

Return ONLY valid JSON.

Use exactly this structure:

{
  "shouldRemember": true,
  "summary": "short clear memory",
  "category": "conversation",
  "importance": "medium"
}

Allowed categories:
- conversation
- person
- project
- task
- preference
- fact

Allowed importance:
- low
- medium
- high

Examples:

User:
"Hey Lucy, remember that I prefer native plants for residential projects."

Return:
{
  "shouldRemember": true,
  "summary": "User prefers native plants for residential projects.",
  "category": "preference",
  "importance": "high"
}

User:
"Hey Lucy, note this: I spoke with Rahul about the Ahmedabad project."

Return:
{
  "shouldRemember": true,
  "summary": "User spoke with Rahul about the Ahmedabad project.",
  "category": "conversation",
  "importance": "medium"
}

User:
"I am just saying hello."

Return:
{
  "shouldRemember": false,
  "summary": "",
  "category": "conversation",
  "importance": "low"
}

User statement:
"${text}"
`;
}

// -----------------------------------------------------------------------------
// OPENAI
// -----------------------------------------------------------------------------

async function callOpenAI(prompt, apiKey, model) {
  const response = await fetch(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.3,
      }),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
        "OpenAI request failed (" + response.status + ")"
    );
  }

  return (
    data?.choices?.[0]?.message?.content?.trim() ||
    "Lucy had nothing to say."
  );
}

// -----------------------------------------------------------------------------
// GEMINI
// -----------------------------------------------------------------------------

async function callGemini(prompt, apiKey, model) {
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    model +
    ":generateContent?key=" +
    apiKey;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            {
              text: prompt,
            },
          ],
        },
      ],
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
        "Gemini request failed (" + response.status + ")"
    );
  }

  const text = data?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("");

  return text?.trim() || "Lucy had nothing to say.";
}

// -----------------------------------------------------------------------------
// MEMORY EXTRACTION
// -----------------------------------------------------------------------------

async function extractMemory(text, apiKey, model) {
  const prompt = buildMemoryPrompt(text);

  try {
    const response = await callGemini(
      prompt,
      apiKey,
      model || DEFAULT_MODELS.gemini
    );

    const cleaned = cleanJsonResponse(response);

    return JSON.parse(cleaned);
  } catch (error) {
    console.log("Lucy memory extraction error:", error);

    return {
      shouldRemember: true,
      summary: text,
      category: "conversation",
      importance: "low",
    };
  }
}

// -----------------------------------------------------------------------------
// APP
// -----------------------------------------------------------------------------

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Lucy />
    </SafeAreaProvider>
  );
}

// -----------------------------------------------------------------------------
// LUCY
// -----------------------------------------------------------------------------

function Lucy() {
  // ---------------------------------------------------------------------------
  // DATA
  // ---------------------------------------------------------------------------

  const [logs, setLogs] = useState([]);
  const [captureText, setCaptureText] = useState("");

  // ---------------------------------------------------------------------------
  // AI RECALL
  // ---------------------------------------------------------------------------

  const [queryText, setQueryText] = useState("");
  const [answer, setAnswer] = useState("");
  const [asking, setAsking] = useState(false);

  // ---------------------------------------------------------------------------
  // SETTINGS
  // ---------------------------------------------------------------------------

  const [settingsVisible, setSettingsVisible] = useState(false);

  const [provider, setProvider] = useState("gemini");

  const [apiKey, setApiKey] = useState("");

  const [model, setModel] = useState(
    DEFAULT_MODELS.gemini
  );

  const [keyDraft, setKeyDraft] = useState("");

  const [modelDraft, setModelDraft] = useState(
    DEFAULT_MODELS.gemini
  );

  // ---------------------------------------------------------------------------
  // VOICE
  // ---------------------------------------------------------------------------

  const [isListening, setIsListening] = useState(false);

  const [transcript, setTranscript] = useState("");

  const [voiceReadyToSave, setVoiceReadyToSave] = useState(false);

  const transcriptRef = useRef("");

  // ---------------------------------------------------------------------------
  // LOAD DATA
  // ---------------------------------------------------------------------------

  useEffect(() => {
    loadStoredData();
  }, []);

  async function loadStoredData() {
    try {
      const [
        storedLogs,
        storedKey,
        storedProvider,
        storedModel,
      ] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.LOGS),
        AsyncStorage.getItem(STORAGE_KEYS.API_KEY),
        AsyncStorage.getItem(STORAGE_KEYS.PROVIDER),
        AsyncStorage.getItem(STORAGE_KEYS.MODEL),
      ]);

      if (storedLogs) {
        try {
          setLogs(JSON.parse(storedLogs));
        } catch {
          setLogs([]);
        }
      }

      const resolvedProvider =
        storedProvider || "gemini";

      const resolvedModel =
        storedModel ||
        DEFAULT_MODELS[resolvedProvider] ||
        DEFAULT_MODELS.gemini;

      setProvider(resolvedProvider);

      setModel(resolvedModel);

      setModelDraft(resolvedModel);

      if (storedKey) {
        setApiKey(storedKey);
        setKeyDraft(storedKey);
      }
    } catch (error) {
      console.log(
        "Lucy failed to load stored data:",
        error
      );
    }
  }

  // ---------------------------------------------------------------------------
  // SAVE LOGS
  // ---------------------------------------------------------------------------

  async function persistLogs(nextLogs) {
    setLogs(nextLogs);

    try {
      await AsyncStorage.setItem(
        STORAGE_KEYS.LOGS,
        JSON.stringify(nextLogs)
      );
    } catch (error) {
      Alert.alert(
        "Couldn't save",
        "Lucy could not save this memory to the device."
      );
    }
  }

  // ---------------------------------------------------------------------------
  // NORMAL TEXT MEMORY
  // ---------------------------------------------------------------------------

  async function handleCapture() {
    const trimmed = captureText.trim();

    if (!trimmed) {
      return;
    }

    const entry = {
      id: Date.now().toString(),
      text: trimmed,
      timestamp: new Date().toISOString(),
    };

    await persistLogs([entry, ...logs]);

    setCaptureText("");

    Speech.stop();

    Speech.speak("I've remembered that.", {
      language: "en-US",
    });
  }

  // ---------------------------------------------------------------------------
  // DELETE MEMORY
  // ---------------------------------------------------------------------------

  async function handleDelete(id) {
    const nextLogs = logs.filter(
      (log) => log.id !== id
    );

    await persistLogs(nextLogs);
  }

  // ---------------------------------------------------------------------------
  // TODAY
  // ---------------------------------------------------------------------------

  const todaysLogs = logs
    .filter((log) => isSameDay(log.timestamp))
    .sort(
      (a, b) =>
        new Date(a.timestamp) -
        new Date(b.timestamp)
    );

  // ---------------------------------------------------------------------------
  // SETTINGS
  // ---------------------------------------------------------------------------

  function openSettings() {
    setKeyDraft(apiKey);
    setModelDraft(model);
    setSettingsVisible(true);
  }

  function switchProvider(nextProvider) {
    setProvider(nextProvider);

    setModelDraft(
      DEFAULT_MODELS[nextProvider]
    );
  }

  async function saveSettings() {
    const nextModel =
      modelDraft.trim() ||
      DEFAULT_MODELS[provider];

    const nextKey = keyDraft.trim();

    try {
      await AsyncStorage.multiSet([
        [STORAGE_KEYS.API_KEY, nextKey],
        [STORAGE_KEYS.PROVIDER, provider],
        [STORAGE_KEYS.MODEL, nextModel],
      ]);

      setApiKey(nextKey);
      setModel(nextModel);

      setSettingsVisible(false);

      Alert.alert(
        "Lucy is ready",
        provider === "gemini"
          ? "Gemini is connected."
          : "OpenAI is connected."
      );
    } catch (error) {
      Alert.alert(
        "Couldn't save settings",
        "Please try again."
      );
    }
  }

  // ---------------------------------------------------------------------------
  // ASK LUCY
  // ---------------------------------------------------------------------------

  async function askLucy(customQuery) {
    const query = (
      customQuery || queryText
    ).trim();

    if (!query) {
      return;
    }

    if (!apiKey) {
      Alert.alert(
        "Add your Gemini API key",
        "Open Settings and add your Gemini API key first."
      );

      openSettings();

      return;
    }

    setAsking(true);
    setAnswer("");

    try {
      const prompt = buildPrompt(
        logs,
        query
      );

      const response =
        provider === "gemini"
          ? await callGemini(
              prompt,
              apiKey,
              model
            )
          : await callOpenAI(
              prompt,
              apiKey,
              model
            );

      setAnswer(response);
    } catch (error) {
      setAnswer(
        "Lucy couldn't reach " +
          (provider === "gemini"
            ? "Gemini"
            : "OpenAI") +
          ". " +
          (error?.message ||
            "Please check your API key, model name, and internet connection.")
      );
    } finally {
      setAsking(false);
    }
  }

  // ---------------------------------------------------------------------------
  // SPEAK ANSWER
  // ---------------------------------------------------------------------------

  function speakAnswer() {
    if (!answer) {
      return;
    }

    Speech.stop();

    Speech.speak(answer, {
      language: "en-US",
      rate: 0.95,
    });
  }

  // ---------------------------------------------------------------------------
  // VOICE EVENTS
  // ---------------------------------------------------------------------------

  useSpeechRecognitionEvent("start", () => {
    setIsListening(true);
  });

  useSpeechRecognitionEvent("end", () => {
    setIsListening(false);
  });

  useSpeechRecognitionEvent(
    "result",
    (event) => {
      try {
        const text =
          event?.results?.[0]?.transcript || "";

        if (!text.trim()) {
          return;
        }

        transcriptRef.current = text;

        setTranscript(text);

        setCaptureText(text);
      } catch (error) {
        console.log(
          "Lucy speech result error:",
          error
        );
      }
    }
  );

  useSpeechRecognitionEvent(
    "error",
    (event) => {
      console.log(
        "Lucy speech error:",
        event?.error,
        event?.message
      );

      setIsListening(false);
    }
  );

  // ---------------------------------------------------------------------------
  // START LISTENING
  // ---------------------------------------------------------------------------

  async function startListening() {
    try {
      const permission =
        await ExpoSpeechRecognitionModule.requestPermissionsAsync();

      if (!permission.granted) {
        Alert.alert(
          "Microphone permission needed",
          "Please allow Lucy to use the microphone."
        );

        return;
      }

      Speech.stop();

      setTranscript("");

      setCaptureText("");

      transcriptRef.current = "";

      ExpoSpeechRecognitionModule.start({
        lang: "en-US",
        interimResults: true,
        maxAlternatives: 1,
        continuous: true,
      });
    } catch (error) {
      console.log(
        "Lucy microphone error:",
        error
      );

      setIsListening(false);

      Alert.alert(
        "Microphone error",
        "Lucy could not start listening."
      );
    }
  }

  // ---------------------------------------------------------------------------
  // STOP LISTENING
  // ---------------------------------------------------------------------------

  function stopListening() {
    setVoiceReadyToSave(true);

    ExpoSpeechRecognitionModule.stop();
  }

  // ---------------------------------------------------------------------------
  // PROCESS VOICE MEMORY
  // ---------------------------------------------------------------------------

  async function handleVoiceMemory() {
    const text =
      (
        transcriptRef.current ||
        transcript
      ).trim();

    if (!text) {
      return;
    }

    const normalizedText = text
      .toLowerCase()
      .replace(/[,.!?]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // ---------------------------------------------------------
    // Remove the wake phrase before processing the command.
    // ---------------------------------------------------------

    let commandText = text;

    const wakePhrases = [
      "hey lucy",
      "okay lucy",
      "ok lucy",
    ];

    for (const phrase of wakePhrases) {
      const lower = commandText.toLowerCase();

      if (lower.includes(phrase)) {
        const index = lower.indexOf(phrase);

        commandText =
          commandText
            .substring(index + phrase.length)
            .trim();

        break;
      }
    }

    const normalizedCommand =
      commandText
        .toLowerCase()
        .replace(/[,.!?]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    // ---------------------------------------------------------
    // VOICE RECALL
    // ---------------------------------------------------------

    const isRecallCommand =
      normalizedCommand.startsWith("what did") ||
      normalizedCommand.startsWith("what was") ||
      normalizedCommand.startsWith("do you remember") ||
      normalizedCommand.startsWith("did i") ||
      normalizedCommand.startsWith("when did") ||
      normalizedCommand.startsWith("tell me about") ||
      normalizedCommand.startsWith("what do you know");

    if (isRecallCommand) {
      setTranscript("");
      setCaptureText("");

      transcriptRef.current = "";

      await askLucy(commandText);

      return;
    }

    // ---------------------------------------------------------
    // VOICE MEMORY COMMAND
    // ---------------------------------------------------------

    const isMemoryCommand =
      normalizedCommand.startsWith("remember") ||
      normalizedCommand.startsWith("remember that") ||
      normalizedCommand.startsWith("note") ||
      normalizedCommand.startsWith("note this") ||
      normalizedCommand.startsWith("please remember") ||
      normalizedText.includes("remember this");

    if (!isMemoryCommand) {
      Speech.speak(
        "I didn't save that. Say Hey Lucy, remember this, followed by what you want me to remember.",
        {
          language: "en-US",
        }
      );

      return;
    }

    if (!apiKey) {
      Alert.alert(
        "Gemini API key needed",
        "Open Settings and add your Gemini API key."
      );

      openSettings();

      return;
    }

    try {
      Speech.speak("Let me remember that.", {
        language: "en-US",
      });

      const memory = await extractMemory(
        commandText,
        apiKey,
        model
      );

      if (!memory?.shouldRemember) {
        Speech.speak(
          "I don't think that needs to be saved.",
          {
            language: "en-US",
          }
        );

        return;
      }

      const summary =
        memory.summary?.trim() ||
        commandText;

      const category =
        memory.category || "conversation";

      const importance =
        memory.importance || "medium";

      const memoryText =
        summary +
        " [" +
        category +
        " • " +
        importance +
        "]";

      const entry = {
        id: Date.now().toString(),
        text: memoryText,
        timestamp: new Date().toISOString(),
      };

      await persistLogs([
        entry,
        ...logs,
      ]);

      setTranscript("");

      setCaptureText("");

      transcriptRef.current = "";

      Speech.stop();

      Speech.speak(
        "I've remembered that.",
        {
          language: "en-US",
        }
      );
    } catch (error) {
      console.log(
        "Lucy voice memory error:",
        error
      );

      Alert.alert(
        "Lucy couldn't remember that",
        error?.message ||
          "Please try again."
      );
    }
  }

  // ---------------------------------------------------------------------------
  // AFTER STOPPING VOICE INPUT
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (
      !isListening &&
      voiceReadyToSave &&
      (
        transcriptRef.current ||
        transcript
      ).trim()
    ) {
      setVoiceReadyToSave(false);

      handleVoiceMemory();
    }
  }, [
    isListening,
    voiceReadyToSave,
    transcript,
  ]);

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------

  return (
    <SafeAreaView
      className="flex-1 bg-[#0f172a]"
      edges={[
        "top",
        "left",
        "right",
      ]}
    >
      <KeyboardAvoidingView
        className="flex-1"
        behavior={
          Platform.OS === "ios"
            ? "padding"
            : undefined
        }
      >
        {/* ------------------------------------------------------- */}
        {/* HEADER */}
        {/* ------------------------------------------------------- */}

        <View className="flex-row items-center justify-between px-5 pt-4 pb-2">
          <View className="flex-row items-center">
            <View className="w-9 h-9 rounded-xl bg-[#6366f1] items-center justify-center mr-3">
              <Ionicons
                name="sparkles"
                size={18}
                color="#f8fafc"
              />
            </View>

            <View>
              <Text className="text-xl font-bold text-[#f8fafc]">
                Lucy
              </Text>

              <Text className="text-xs text-[#64748b]">
                Your memory, kept honest
              </Text>
            </View>
          </View>

          <View className="flex-row items-center">
            {/* MICROPHONE */}

            <TouchableOpacity
              onPress={
                isListening
                  ? stopListening
                  : startListening
              }
              className={`w-11 h-11 rounded-xl items-center justify-center mr-2 ${
                isListening
                  ? "bg-red-500"
                  : "bg-[#1e293b]"
              }`}
              accessibilityLabel={
                isListening
                  ? "Stop listening"
                  : "Talk to Lucy"
              }
            >
              <Ionicons
                name={
                  isListening
                    ? "mic"
                    : "mic-outline"
                }
                size={20}
                color="#f8fafc"
              />
            </TouchableOpacity>

            {/* SETTINGS */}

            <TouchableOpacity
              onPress={openSettings}
              className="w-11 h-11 rounded-xl bg-[#1e293b] items-center justify-center"
              accessibilityLabel="Settings"
            >
              <Ionicons
                name="settings-outline"
                size={20}
                color="#94a3b8"
              />
            </TouchableOpacity>
          </View>
        </View>

        {/* ------------------------------------------------------- */}
        {/* VOICE STATUS */}
        {/* ------------------------------------------------------- */}

        {isListening ? (
          <View className="mx-5 mt-2 mb-2 rounded-xl bg-[#3f1d2e] px-4 py-3">
            <View className="flex-row items-center">
              <Ionicons
                name="mic"
                size={17}
                color="#f87171"
              />

              <Text className="text-[#fca5a5] font-semibold ml-2">
                Listening...
              </Text>
            </View>

            {transcript ? (
              <Text className="text-[#f8fafc] text-sm mt-2">
                {transcript}
              </Text>
            ) : (
              <Text className="text-[#94a3b8] text-xs mt-1">
                Say "Hey Lucy, remember this..."
              </Text>
            )}
          </View>
        ) : null}

        {/* ------------------------------------------------------- */}
        {/* TIMELINE */}
        {/* ------------------------------------------------------- */}

        <FlatList
          className="flex-1 px-5"
          data={todaysLogs}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View>
              {/* MEMORY CAPTURE */}

              <View className="bg-[#1e293b] rounded-xl p-4 mt-2 mb-5">
                <TextInput
                  value={captureText}
                  onChangeText={
                    setCaptureText
                  }
                  placeholder="What just happened?"
                  placeholderTextColor="#64748b"
                  className="text-[#f8fafc] text-base min-h-[44px]"
                  multiline
                />

                <TouchableOpacity
                  onPress={handleCapture}
                  disabled={
                    !captureText.trim()
                  }
                  className={`mt-3 rounded-xl h-11 items-center justify-center ${
                    captureText.trim()
                      ? "bg-[#6366f1]"
                      : "bg-[#334155]"
                  }`}
                >
                  <Text className="text-[#f8fafc] font-semibold">
                    Remember This
                  </Text>
                </TouchableOpacity>

                {/* TALK TO LUCY BUTTON */}

                <TouchableOpacity
                  onPress={
                    isListening
                      ? stopListening
                      : startListening
                  }
                  className={`mt-3 rounded-xl h-11 items-center justify-center ${
                    isListening
                      ? "bg-red-500"
                      : "bg-[#334155]"
                  }`}
                >
                  <View className="flex-row items-center">
                    <Ionicons
                      name={
                        isListening
                          ? "mic"
                          : "mic-outline"
                      }
                      size={18}
                      color="#f8fafc"
                    />

                    <Text className="text-[#f8fafc] font-semibold ml-2">
                      {isListening
                        ? "Listening..."
                        : "Talk to Lucy"}
                    </Text>
                  </View>
                </TouchableOpacity>
              </View>

              {/* TODAY HEADER */}

              <View className="flex-row items-center justify-between mb-2">
                <Text className="text-[#f8fafc] text-sm font-semibold">
                  Today
                </Text>

                <Text className="text-[#64748b] text-xs">
                  {todaysLogs.length} logged
                </Text>
              </View>
            </View>
          }
          renderItem={({ item }) => (
            <View className="flex-row items-start bg-[#1e293b] rounded-xl p-3 mb-2">
              <Text className="text-[#6366f1] text-xs font-semibold w-16 pt-0.5">
                {formatTime(
                  new Date(
                    item.timestamp
                  )
                )}
              </Text>

              <Text className="flex-1 text-[#f8fafc] text-sm pr-2">
                {item.text}
              </Text>

              <TouchableOpacity
                onPress={() =>
                  handleDelete(item.id)
                }
                className="w-8 h-8 items-center justify-center"
                hitSlop={{
                  top: 10,
                  bottom: 10,
                  left: 10,
                  right: 10,
                }}
                accessibilityLabel="Delete entry"
              >
                <Ionicons
                  name="trash-outline"
                  size={16}
                  color="#64748b"
                />
              </TouchableOpacity>
            </View>
          )}
          ListEmptyComponent={
            <View className="items-center py-10">
              <Text className="text-[#64748b] text-sm">
                Nothing logged yet today.
              </Text>
            </View>
          }
          ListFooterComponent={
            <View className="h-3" />
          }
        />

        {/* ------------------------------------------------------- */}
        {/* AI RECALL */}
        {/* ------------------------------------------------------- */}

        <View className="px-5 pb-4 pt-3 border-t border-[#1e293b]">
          {answer ? (
            <View className="flex-row items-start bg-[#1e293b] rounded-xl p-4 mb-3 max-h-40">
              <ScrollView className="flex-1">
                <Text className="text-[#f8fafc] text-sm leading-5">
                  {answer}
                </Text>
              </ScrollView>

              <TouchableOpacity
                onPress={speakAnswer}
                className="w-8 h-8 items-center justify-center ml-2"
                accessibilityLabel="Read answer aloud"
              >
                <Ionicons
                  name="volume-high-outline"
                  size={18}
                  color="#94a3b8"
                />
              </TouchableOpacity>
            </View>
          ) : null}

          <View className="flex-row items-center">
            <TextInput
              value={queryText}
              onChangeText={
                setQueryText
              }
              placeholder="Ask Lucy what you're forgetting..."
              placeholderTextColor="#64748b"
              className="flex-1 bg-[#1e293b] text-[#f8fafc] rounded-xl px-4 h-11 mr-2"
              returnKeyType="send"
              onSubmitEditing={() =>
                askLucy()
              }
            />

            <TouchableOpacity
              onPress={() =>
                askLucy()
              }
              disabled={
                asking ||
                !queryText.trim()
              }
              className={`w-11 h-11 rounded-xl items-center justify-center ${
                asking ||
                !queryText.trim()
                  ? "bg-[#334155]"
                  : "bg-[#6366f1]"
              }`}
              accessibilityLabel="Ask Lucy"
            >
              {asking ? (
                <ActivityIndicator
                  color="#f8fafc"
                  size="small"
                />
              ) : (
                <Ionicons
                  name="send"
                  size={18}
                  color="#f8fafc"
                />
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* --------------------------------------------------------- */}
      {/* SETTINGS MODAL */}
      {/* --------------------------------------------------------- */}

      <Modal
        visible={settingsVisible}
        animationType="slide"
        transparent
        onRequestClose={() =>
          setSettingsVisible(false)
        }
      >
        <KeyboardAvoidingView
          className="flex-1 justify-end"
          behavior={
            Platform.OS === "ios"
              ? "padding"
              : undefined
          }
        >
          <View className="bg-black/50 flex-1 justify-end">
            <View className="bg-[#0f172a] rounded-t-2xl p-5 pb-8">
              {/* TITLE */}

              <View className="flex-row items-center justify-between mb-5">
                <Text className="text-[#f8fafc] text-lg font-bold">
                  Settings
                </Text>

                <TouchableOpacity
                  onPress={() =>
                    setSettingsVisible(
                      false
                    )
                  }
                  className="w-9 h-9 items-center justify-center"
                  accessibilityLabel="Close settings"
                >
                  <Ionicons
                    name="close"
                    size={22}
                    color="#94a3b8"
                  />
                </TouchableOpacity>
              </View>

              {/* PROVIDER */}

              <Text className="text-[#94a3b8] text-sm font-medium mb-2">
                AI provider
              </Text>

              <View className="flex-row mb-4">
                <TouchableOpacity
                  onPress={() =>
                    switchProvider(
                      "openai"
                    )
                  }
                  className={`flex-1 h-11 rounded-xl items-center justify-center mr-2 ${
                    provider === "openai"
                      ? "bg-[#6366f1]"
                      : "bg-[#1e293b]"
                  }`}
                >
                  <Text className="text-[#f8fafc] font-medium">
                    OpenAI
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() =>
                    switchProvider(
                      "gemini"
                    )
                  }
                  className={`flex-1 h-11 rounded-xl items-center justify-center ${
                    provider === "gemini"
                      ? "bg-[#6366f1]"
                      : "bg-[#1e293b]"
                  }`}
                >
                  <Text className="text-[#f8fafc] font-medium">
                    Gemini
                  </Text>
                </TouchableOpacity>
              </View>

              {/* API KEY */}

              <Text className="text-[#94a3b8] text-sm font-medium mb-2">
                API key
              </Text>

              <TextInput
                value={keyDraft}
                onChangeText={
                  setKeyDraft
                }
                placeholder={
                  provider ===
                  "openai"
                    ? "sk-..."
                    : "AIza..."
                }
                placeholderTextColor="#64748b"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                className="bg-[#1e293b] text-[#f8fafc] rounded-xl px-4 h-11 mb-4"
              />

              {/* MODEL */}

              <Text className="text-[#94a3b8] text-sm font-medium mb-2">
                Model name
              </Text>

              <TextInput
                value={modelDraft}
                onChangeText={
                  setModelDraft
                }
                placeholder={
                  DEFAULT_MODELS[
                    provider
                  ]
                }
                placeholderTextColor="#64748b"
                autoCapitalize="none"
                autoCorrect={false}
                className="bg-[#1e293b] text-[#f8fafc] rounded-xl px-4 h-11 mb-1"
              />

              <Text className="text-[#64748b] text-xs mb-5">
                Gemini default: gemini-2.5-flash
              </Text>

              {/* SAVE */}

              <TouchableOpacity
                onPress={
                  saveSettings
                }
                className="bg-[#6366f1] h-11 rounded-xl items-center justify-center"
              >
                <Text className="text-[#f8fafc] font-semibold">
                  Save settings
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
