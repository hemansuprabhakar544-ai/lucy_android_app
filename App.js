// App.js
// -----------------------------------------------------------------------------
// Lucy — a personal AI memory assistant.
// Log what happens during your day, browse it as a timeline, then ask Lucy
// (OpenAI or Gemini) whether you're forgetting anything.
//
// This file is the entire app. See the setup instructions provided alongside
// this file for how to turn it into a running Expo project and an Android APK.
// -----------------------------------------------------------------------------

import "./global.css"; // NativeWind — must be the very first import

import React, { useState, useEffect } from "react";
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
} from "react-native";`import { SafeAreaView, SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import * as Speech from "expo-speech";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
const STORAGE_KEYS = {
  LOGS: "lucy_logs",
  API_KEY: "lucy_api_key",
  PROVIDER: "lucy_provider",
  MODEL: "lucy_model",
};

// Sensible current defaults. AI providers retire model names over time, so the
// model is also an editable field in Settings — update it there if a request
// ever fails with a "model not found" style error.
const DEFAULT_MODELS = {
  openai: "gpt-5-mini",
  gemini: "gemini-3.5-flash",
};

// -----------------------------------------------------------------------------
// Small helpers
// -----------------------------------------------------------------------------

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function isSameDay(isoString) {
  const d = new Date(isoString);
  const now = new Date();
  return (
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear()
  );
}

// Builds the exact prompt Lucy answers from: current time, today's logs, and
// the user's question, all in one message.
function buildPrompt(todaysLogs, query) {
  const now = new Date();
  const logLines =
    todaysLogs
      .map((log) => `- [${formatTime(new Date(log.timestamp))}] ${log.text}`)
      .join("\n") || "(nothing logged yet today)";

  return (
    `You are Lucy, a strict personal memory assistant. ` +
    `The current time is ${formatTime(now)} on ${now.toDateString()}. ` +
    `Today's logs:\n${logLines}\n\n` +
    `User Query: ${query}\n\n` +
    `Answer chronologically and highlight any pending tasks.`
  );
}

// -----------------------------------------------------------------------------
// API calls
// -----------------------------------------------------------------------------

async function callOpenAI(prompt, apiKey, model) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || `OpenAI request failed (${response.status})`);
  }
  return data?.choices?.[0]?.message?.content?.trim() || "Lucy had nothing to say.";
}

async function callGemini(prompt, apiKey, model) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || `Gemini request failed (${response.status})`);
  }
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("");
  return text?.trim() || "Lucy had nothing to say.";
}

// -----------------------------------------------------------------------------
// Root component
// -----------------------------------------------------------------------------

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Lucy />
    </SafeAreaProvider>
  );
}
async function extractMemory(text, apiKey, model) {
  const prompt = `
You are Lucy, a personal memory assistant.

Analyze the user's statement below.

Decide whether it contains information that would be useful to remember later.

Return ONLY valid JSON in exactly this format:

{
  "shouldRemember": true,
  "summary": "short clear memory",
  "category": "task",
  "importance": "medium"
}

Allowed categories:
- task
- person
- project
- preference
- fact
- conversation

Allowed importance:
- low
- medium
- high

If the statement is casual conversation with no useful lasting information,
set "shouldRemember" to false.

User statement:
"${text}"
`;

  try {
    const response = await callGemini(prompt, apiKey, model);

    const cleaned = response
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

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
function Lucy() {
  // Data
  const [logs, setLogs] = useState([]);
  const [captureText, setCaptureText] = useState("");
  const [voiceReadyToSave, setVoiceReadyToSave] = useState(false);

  useEffect(() => {
  if (!isListening && voiceReadyToSave && transcript.trim()) {
    setVoiceReadyToSave(false);
    handleCapture();
  }
}, [isListening, voiceReadyToSave, transcript]);

  // Voice input
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");

 // Speech recognition events
  useSpeechRecognitionEvent("start", () => {
    setIsListening(true);
  });

  useSpeechRecognitionEvent("end", () => {
    setIsListening(false);
  });

  useSpeechRecognitionEvent("result", (event) => {
    const text = event.results[0]?.transcript || "";
    setTranscript(text);
    setCaptureText(text);
  });

  useSpeechRecognitionEvent("error", (event) => {
    console.log("Lucy speech error:", event.error, event.message);
    setIsListening(false);
  });

  // AI recall
  const [queryText, setQueryText] = useState("");
  const [answer, setAnswer] = useState("");
  const [asking, setAsking] = useState(false);

  // Settings
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [provider, setProvider] = useState("openai");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(DEFAULT_MODELS.openai);
  // Drafts let the user cancel out of Settings without losing saved values.
  const [keyDraft, setKeyDraft] = useState("");
  const [modelDraft, setModelDraft] = useState(DEFAULT_MODELS.openai);

  useEffect(() => {
    loadStoredData();
  }, []);

  const loadStoredData = async () => {
    try {
      const [storedLogs, storedKey, storedProvider, storedModel] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.LOGS),
        AsyncStorage.getItem(STORAGE_KEYS.API_KEY),
        AsyncStorage.getItem(STORAGE_KEYS.PROVIDER),
        AsyncStorage.getItem(STORAGE_KEYS.MODEL),
      ]);

      if (storedLogs) setLogs(JSON.parse(storedLogs));

      const resolvedProvider = storedProvider || "openai";
      setProvider(resolvedProvider);

      if (storedKey) {
        setApiKey(storedKey);
        setKeyDraft(storedKey);
      }

      const resolvedModel = storedModel || DEFAULT_MODELS[resolvedProvider];
      setModel(resolvedModel);
      setModelDraft(resolvedModel);
    } catch (error) {
      console.warn("Lucy: failed to load stored data", error);
    }
  };

  const persistLogs = async (nextLogs) => {
    setLogs(nextLogs);
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.LOGS, JSON.stringify(nextLogs));
    } catch (error) {
      Alert.alert("Couldn't save", "Your log wasn't saved to the device. Try again.");
    }
  };
    const startListening = async () => {
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

      setTranscript("");
      setCaptureText("");

      ExpoSpeechRecognitionModule.start({
        lang: "en-US",
        interimResults: true,
        maxAlternatives: 1,
        continuous: true,
      });
    } catch (error) {
      console.log("Lucy microphone error:", error);
      setIsListening(false);
    }
  };

 const stopListening = () => {
  setVoiceReadyToSave(true);
  ExpoSpeechRecognitionModule.stop();
};
const handleVoiceMemory = async () => {
  const text = transcript.trim();

  if (!text) return;

  try {
    if (!apiKey) {
      Alert.alert(
        "Gemini API key needed",
        "Please add your Gemini API key in Settings."
      );
      return;
    }

    const memory = await extractMemory(text, apiKey, model);

    if (memory.shouldRemember) {
      const memoryText = `${memory.summary} [${memory.category} • ${memory.importance}]`;

      const entry = {
        id: Date.now().toString(),
        text: memoryText,
        timestamp: new Date().toISOString(),
      };

      await persistLogs([entry, ...logs]);

      setTranscript("");
      setCaptureText("");

      Speech.speak("I've remembered that.");
    } else {
      Speech.speak("I won't save that as a memory.");
    }
  } catch (error) {
    console.log("Lucy voice memory error:", error);
    Alert.alert(
      "Lucy couldn't remember that",
      error?.message || "Please try again."
    );
  }
};
  const handleCapture = async () => {
    const trimmed = captureText.trim();
    if (!trimmed) return;

    const entry = {
      id: Date.now().toString(),
      text: trimmed,
      timestamp: new Date().toISOString(),
    };
    await persistLogs([entry, ...logs]);
    setCaptureText("");
  };

  const handleDelete = async (id) => {
    await persistLogs(logs.filter((log) => log.id !== id));
  };

  const todaysLogs = logs
    .filter((log) => isSameDay(log.timestamp))
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  const openSettings = () => {
    setKeyDraft(apiKey);
    setModelDraft(model);
    setSettingsVisible(true);
  };

  const switchProvider = (nextProvider) => {
    setProvider(nextProvider);
    // Only reset the model draft if the user hasn't customized it yet.
    if (modelDraft === DEFAULT_MODELS[provider] || modelDraft.trim() === "") {
      setModelDraft(DEFAULT_MODELS[nextProvider]);
    }
  };

  const saveSettings = async () => {
    const nextModel = modelDraft.trim() || DEFAULT_MODELS[provider];
    try {
      await AsyncStorage.multiSet([
        [STORAGE_KEYS.API_KEY, keyDraft.trim()],
        [STORAGE_KEYS.PROVIDER, provider],
        [STORAGE_KEYS.MODEL, nextModel],
      ]);
      setApiKey(keyDraft.trim());
      setModel(nextModel);
      setSettingsVisible(false);
    } catch (error) {
      Alert.alert("Couldn't save settings", "Please try again.");
    }
  };

  const askLucy = async () => {
    const query = queryText.trim();
    if (!query) return;

    if (!apiKey) {
      Alert.alert("Add an API key", "Open Settings and add your OpenAI or Gemini API key first.");
      openSettings();
      return;
    }

    setAsking(true);
    setAnswer("");
    try {
      const prompt = buildPrompt(todaysLogs, query);
      const text =
        provider === "gemini"
          ? await callGemini(prompt, apiKey, model)
          : await callOpenAI(prompt, apiKey, model);
      setAnswer(text);
    } catch (error) {
      setAnswer(
        `Couldn't reach ${provider === "gemini" ? "Gemini" : "OpenAI"}: ${error.message}. ` +
          `Check your API key, model name, and internet connection.`
      );
    } finally {
      setAsking(false);
    }
  };

  const speakAnswer = () => {
    if (!answer) return;
    Speech.stop();
    Speech.speak(answer, { language: "en-US" });
  };

  return (
    <SafeAreaView className="flex-1 bg-[#0f172a]" edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Header */}
        <View className="flex-row items-center justify-between px-5 pt-4 pb-2">
          <View className="flex-row items-center">
            <View className="w-9 h-9 rounded-xl bg-[#6366f1] items-center justify-center mr-3">
              <Ionicons name="sparkles" size={18} color="#f8fafc" />
            </View>
            <View>
              <Text className="text-xl font-bold text-[#f8fafc]">Lucy</Text>
              <Text className="text-xs text-[#64748b]">Your memory, kept honest</Text>
            </View>
          </View>
          <TouchableOpacity
            onPress={openSettings}
            className="w-11 h-11 rounded-xl bg-[#1e293b] items-center justify-center"
            accessibilityLabel="Settings"
          >
            <Ionicons name="settings-outline" size={20} color="#94a3b8" />
          </TouchableOpacity>
           <TouchableOpacity
  onPress={isListening ? stopListening : startListening}
  className={`mt-3 rounded-xl h-11 items-center justify-center ${
    isListening ? "bg-red-500" : "bg-[#334155]"
  }`}
  accessibilityLabel={isListening ? "Stop listening" : "Start listening"}
>
  <View className="flex-row items-center">
    <Ionicons
      name={isListening ? "mic" : "mic-outline"}
      size={18}
      color="#f8fafc"
    />
    <Text className="text-[#f8fafc] font-semibold ml-2">
      {isListening ? "Listening..." : "Talk to Lucy"}
    </Text>
  </View>
</TouchableOpacity>
        </View>

        {/* Timeline, with the capture card as its header so the whole screen scrolls together */}
        <FlatList
          className="flex-1 px-5"
          data={todaysLogs}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View>
              <View className="bg-[#1e293b] rounded-xl p-4 mt-2 mb-5">
                <TextInput
                  value={captureText}
                  onChangeText={setCaptureText}
                  placeholder="What just happened?"
                  placeholderTextColor="#64748b"
                  className="text-[#f8fafc] text-base min-h-[44px]"
                  multiline
                />
                <TouchableOpacity
                  onPress={handleCapture}
                  disabled={!captureText.trim()}
                  className={`mt-3 rounded-xl h-11 items-center justify-center ${
                    captureText.trim() ? "bg-[#6366f1]" : "bg-[#334155]"
                  }`}
                >
                  <Text className="text-[#f8fafc] font-semibold">Remember This</Text>
                </TouchableOpacity>
              </View>

              <View className="flex-row items-center justify-between mb-2">
                <Text className="text-[#f8fafc] text-sm font-semibold">Today</Text>
                <Text className="text-[#64748b] text-xs">{todaysLogs.length} logged</Text>
              </View>
            </View>
          }
          renderItem={({ item }) => (
            <View className="flex-row items-start bg-[#1e293b] rounded-xl p-3 mb-2">
              <Text className="text-[#6366f1] text-xs font-semibold w-16 pt-0.5">
                {formatTime(new Date(item.timestamp))}
              </Text>
              <Text className="flex-1 text-[#f8fafc] text-sm pr-2">{item.text}</Text>
              <TouchableOpacity
                onPress={() => handleDelete(item.id)}
                className="w-8 h-8 items-center justify-center"
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityLabel="Delete entry"
              >
                <Ionicons name="trash-outline" size={16} color="#64748b" />
              </TouchableOpacity>
            </View>
          )}
          ListEmptyComponent={
            <View className="items-center py-10">
              <Text className="text-[#64748b] text-sm">Nothing logged yet today.</Text>
            </View>
          }
          ListFooterComponent={<View className="h-3" />}
        />

        {/* AI Recall */}
        <View className="px-5 pb-4 pt-3 border-t border-[#1e293b]">
          {answer ? (
            <View className="flex-row items-start bg-[#1e293b] rounded-xl p-4 mb-3 max-h-40">
              <ScrollView className="flex-1">
                <Text className="text-[#f8fafc] text-sm leading-5">{answer}</Text>
              </ScrollView>
              <TouchableOpacity
                onPress={speakAnswer}
                className="w-8 h-8 items-center justify-center ml-2"
                accessibilityLabel="Read answer aloud"
              >
                <Ionicons name="volume-high-outline" size={18} color="#94a3b8" />
              </TouchableOpacity>
            </View>
          ) : null}

          <View className="flex-row items-center">
            <TextInput
              value={queryText}
              onChangeText={setQueryText}
              placeholder="Ask Lucy what you're forgetting..."
              placeholderTextColor="#64748b"
              className="flex-1 bg-[#1e293b] text-[#f8fafc] rounded-xl px-4 h-11 mr-2"
              returnKeyType="send"
              onSubmitEditing={askLucy}
            />
            <TouchableOpacity
              onPress={askLucy}
              disabled={asking || !queryText.trim()}
              className={`w-11 h-11 rounded-xl items-center justify-center ${
                asking || !queryText.trim() ? "bg-[#334155]" : "bg-[#6366f1]"
              }`}
              accessibilityLabel="Ask Lucy"
            >
              {asking ? (
                <ActivityIndicator color="#f8fafc" size="small" />
              ) : (
                <Ionicons name="send" size={18} color="#f8fafc" />
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* Settings modal */}
      <Modal
        visible={settingsVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setSettingsVisible(false)}
      >
        <KeyboardAvoidingView
          className="flex-1 justify-end"
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View className="bg-black/50 flex-1 justify-end">
            <View className="bg-[#0f172a] rounded-t-2xl p-5 pb-8">
              <View className="flex-row items-center justify-between mb-5">
                <Text className="text-[#f8fafc] text-lg font-bold">Settings</Text>
                <TouchableOpacity
                  onPress={() => setSettingsVisible(false)}
                  className="w-9 h-9 items-center justify-center"
                  accessibilityLabel="Close settings"
                >
                  <Ionicons name="close" size={22} color="#94a3b8" />
                </TouchableOpacity>
              </View>

              <Text className="text-[#94a3b8] text-sm font-medium mb-2">AI provider</Text>
              <View className="flex-row mb-4">
                <TouchableOpacity
                  onPress={() => switchProvider("openai")}
                  className={`flex-1 h-11 rounded-xl items-center justify-center mr-2 ${
                    provider === "openai" ? "bg-[#6366f1]" : "bg-[#1e293b]"
                  }`}
                >
                  <Text className="text-[#f8fafc] font-medium">OpenAI</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => switchProvider("gemini")}
                  className={`flex-1 h-11 rounded-xl items-center justify-center ${
                    provider === "gemini" ? "bg-[#6366f1]" : "bg-[#1e293b]"
                  }`}
                >
                  <Text className="text-[#f8fafc] font-medium">Gemini</Text>
                </TouchableOpacity>
              </View>

              <Text className="text-[#94a3b8] text-sm font-medium mb-2">API key</Text>
              <TextInput
                value={keyDraft}
                onChangeText={setKeyDraft}
                placeholder={provider === "openai" ? "sk-..." : "AIza..."}
                placeholderTextColor="#64748b"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                className="bg-[#1e293b] text-[#f8fafc] rounded-xl px-4 h-11 mb-4"
              />

              <Text className="text-[#94a3b8] text-sm font-medium mb-2">Model name</Text>
              <TextInput
                value={modelDraft}
                onChangeText={setModelDraft}
                placeholder={DEFAULT_MODELS[provider]}
                placeholderTextColor="#64748b"
                autoCapitalize="none"
                autoCorrect={false}
                className="bg-[#1e293b] text-[#f8fafc] rounded-xl px-4 h-11 mb-1"
              />
              <Text className="text-[#64748b] text-xs mb-5">
                Defaults to {DEFAULT_MODELS[provider]}. Change it if your provider retires that
                model.
              </Text>

              <TouchableOpacity
                onPress={saveSettings}
                className="bg-[#6366f1] h-11 rounded-xl items-center justify-center"
              >
                <Text className="text-[#f8fafc] font-semibold">Save settings</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
