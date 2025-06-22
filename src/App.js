import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot, collection, query, where, addDoc, getDocs } from 'firebase/firestore';

// Main App component
const App = () => {

    const firebaseConfig = {

        apiKey: "AIzaSyCPEPmupqvkYwAvS32CAQSc4z7bFF0SpfY",

        authDomain: "russian-bomb-party.firebaseapp.com",

        projectId: "russian-bomb-party",

        storageBucket: "russian-bomb-party.firebasestorage.app",

        messagingSenderId: "725758041672",

        appId: "1:725758041672:web:e53c6dcef8572d7bdfc27d",

        measurementId: "G-2GL6MHK7YV"

    };

    
    const APP_ID_FOR_FIRESTORE_PATH = "russian-bomb-party-prod";
    // Firebase related states
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);

    // Game states
    const [currentScreen, setCurrentScreen] = useState('lobby'); // 'lobby', 'game', 'game-over'
    const [roomIdInput, setRoomIdInput] = useState('');
    const [usernameInput, setUsernameInput] = useState(''); // New state for username
    const [currentRoomId, setCurrentRoomId] = useState(null);
    const [gameData, setGameData] = useState(null); // Stores real-time game data from Firestore
    const [wordInput, setWordInput] = useState('');
    const [message, setMessage] = useState(''); // General messages for user feedback
    const [isGeneratingLetters, setIsGeneratingLetters] = useState(false); // For LLM call loading
    const [isCheckingWord, setIsCheckingWord] = useState(false); // For dictionary API call loading

    // Yandex Dictionary API Key and URL
    const YANDEX_DICT_API_KEY = "dict.1.1.20250622T153840Z.0f7f454520cc6ced.e8b8af1faaa417735e8c9ed43f91340f72c70d28";
    const YANDEX_DICT_API_URL = "https://dictionary.yandex.net/api/v1/dicservice.json/lookup";


    // 1. Initialize Firebase and handle authentication
    useEffect(() => {
        try {
            // Check if Firebase config is available from the environment
            const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;
            const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

            if (!firebaseConfig) {
                console.error("Firebase config is not defined. Cannot initialize Firebase.");
                setMessage("Error: Firebase configuration missing. Please ensure the environment is set up correctly.");
                return;
            }

            // Initialize Firebase app
            const app = initializeApp(firebaseConfig);
            const firestore = getFirestore(app);
            const authentication = getAuth(app);

            setDb(firestore);
            setAuth(authentication);

            // Listen for auth state changes
            const unsubscribeAuth = onAuthStateChanged(authentication, async (user) => {
                if (user) {
                    setUserId(user.uid);
                    setIsAuthReady(true);
                } else {
                    // Sign in anonymously if no user is found and no custom token is provided
                    try {
                        const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
                        if (initialAuthToken) {
                            await signInWithCustomToken(authentication, initialAuthToken);
                        } else {
                            await signInAnonymously(authentication);
                        }
                    } catch (error) {
                        console.error("Error during anonymous sign-in or custom token sign-in:", error);
                        setMessage(`Authentication failed: ${error.message}`);
                    }
                }
            });

            // Cleanup subscription on unmount
            return () => unsubscribeAuth();
        } catch (error) {
            console.error("Error initializing Firebase:", error);
            setMessage(`Failed to initialize application: ${error.message}`);
        }
    }, []);

    // 2. Listen to game room data from Firestore
    useEffect(() => {
        if (!db || !isAuthReady || !currentRoomId) {
            return;
        }

        const roomDocRef = doc(db, `artifacts/${typeof __app_id !== 'undefined' ? __app_id : 'default-app-id'}/public/data/gameRooms`, currentRoomId);

        const unsubscribeGameData = onSnapshot(roomDocRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                setGameData(data);

                // Check for game over condition (only one player left with lives)
                const activePlayers = data.players.filter(p => p.lives > 0);
                if (data.status === 'in-game' && activePlayers.length <= 1 && data.players.length > 0) {
                     // If only one player left with lives, that player wins (or no players left)
                    if (activePlayers.length === 1) {
                        const winnerUsername = getUsernameById(activePlayers[0].id, data.players);
                        setMessage(`Game Over! ${activePlayers[0].id === userId ? 'Ты' : winnerUsername} победил(а)!`);
                    } else if (activePlayers.length === 0) {
                        setMessage("Game Over! No players left with lives.");
                    }
                    updateDoc(roomDocRef, { status: 'game-over' }); // Mark room as game-over
                } else if (data.status === 'in-game') {
                    setCurrentScreen('game');
                } else if (data.status === 'game-over') {
                    setCurrentScreen('game-over');
                }
            } else {
                setMessage("Room does not exist or was deleted.");
                setCurrentScreen('lobby');
                setCurrentRoomId(null);
                setGameData(null);
            }
        }, (error) => {
            console.error("Error fetching game data:", error);
            setMessage(`Error fetching game data: ${error.message}`);
        });

        // Cleanup subscription
        return () => unsubscribeGameData();
    }, [db, isAuthReady, currentRoomId, userId]);


    // Function to generate random Russian letters using LLM
    const generateLettersWithLLM = async () => {
        setIsGeneratingLetters(true);
        try {
            const prompt = "Generate a sequence of 2 or 3 common, consecutive Russian letters that can be found within a single Russian word. For example: 'СТ' or 'ПЕР'. Provide only the letters, no extra text or punctuation. Keep it short.";
            let chatHistory = [];
            chatHistory.push({ role: "user", parts: [{ text: prompt }] });
            const payload = { contents: chatHistory };
            const apiKey = ""; // Canvas will provide this
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();

            if (result.candidates && result.candidates.length > 0 &&
                result.candidates[0].content && result.candidates[0].content.parts &&
                result.candidates[0].content.parts.length > 0) {
                const text = result.candidates[0].content.parts[0].text.trim().toUpperCase();
                // Basic sanitation to ensure it's just letters
                return text.replace(/[^А-ЯЁ]/g, '');
            } else {
                console.error("LLM response structure unexpected:", result);
                setMessage("Failed to generate letters via AI. Using fallback.");
                // Fallback to a simple random letter generation if LLM fails
                const FALLBACK_LETTERS = ['ПТ', 'СТ', 'ВР', 'ДОМ', 'КНИ'];
                return FALLBACK_LETTERS[Math.floor(Math.random() * FALLBACK_LETTERS.length)];
            }
        } catch (error) {
            console.error("Error calling LLM for letters:", error);
            setMessage(`Failed to generate letters via AI: ${error.message}. Using fallback.`);
            // Fallback to a simple random letter generation if API call fails
            const FALLBACK_LETTERS = ['ПР', 'ГЛ', 'ЗВ', 'ОКН', 'СЛО'];
            return FALLBACK_LETTERS[Math.floor(Math.random() * FALLBACK_LETTERS.length)];
        } finally {
            setIsGeneratingLetters(false);
        }
    };

    // Function to check if a word exists in the dictionary using Yandex API
    const checkWordInDictionary = async (word) => {
        setIsCheckingWord(true);
        try {
            const url = new URL(YANDEX_DICT_API_URL);
            url.searchParams.append('key', YANDEX_DICT_API_KEY);
            url.searchParams.append('lang', 'ru-ru'); // Russian to Russian
            url.searchParams.append('text', word);

            const response = await fetch(url.toString());
            const data = await response.json();

            // The Yandex Dictionary API returns an array in 'def' if the word is found.
            // If 'def' is empty, the word is not found.
            return data.def && data.def.length > 0;
        } catch (error) {
            console.error("Error checking word with Yandex Dictionary API:", error);
            setMessage(`Ошибка при проверке слова: ${error.message}. Проверьте соединение.`);
            return false; // Assume word is not valid on error
        } finally {
            setIsCheckingWord(false);
        }
    };


    // Function to create a new game room
    const createRoom = async () => {
        if (!db || !userId) {
            setMessage("Application not ready. Please wait.");
            return;
        }
        if (!roomIdInput.trim()) {
            setMessage("Please enter a room name.");
            return;
        }
        if (!usernameInput.trim()) { // New validation for username
            setMessage("Пожалуйста, введите имя пользователя.");
            return;
        }

        const roomRef = doc(db, `artifacts/${typeof __app_id !== 'undefined' ? __app_id : 'default-app-id'}/public/data/gameRooms`, roomIdInput);

        try {
            const docSnap = await getDoc(roomRef);
            if (docSnap.exists()) {
                setMessage(`Room '${roomIdInput}' already exists. Try joining it or pick a different name.`);
                return;
            }

            const initialGameData = {
                status: 'lobby',
                players: [{ id: userId, username: usernameInput.trim(), score: 0, lives: 2 }], // Store username
                currentLetters: '',
                activePlayerId: null,
                wordHistory: [],
                timerEndTime: null,
                createdAt: new Date().toISOString(), // Store as ISO string
                hostId: userId,
            };
            await setDoc(roomRef, initialGameData);
            setCurrentRoomId(roomIdInput);
            setCurrentScreen('game');
            setMessage(`Room '${roomIdInput}' created! Waiting for players...`);
        } catch (error) {
            console.error("Error creating room:", error);
            setMessage(`Failed to create room: ${error.message}`);
        }
    };

    // Function to join an existing game room
    const joinRoom = async () => {
        if (!db || !userId) {
            setMessage("Application not ready. Please wait.");
            return;
        }
        if (!roomIdInput.trim()) {
            setMessage("Please enter a room name.");
            return;
        }
        if (!usernameInput.trim()) { // New validation for username
            setMessage("Пожалуйста, введите имя пользователя.");
            return;
        }

        const roomRef = doc(db, `artifacts/${typeof __app_id !== 'undefined' ? __app_id : 'default-app-id'}/public/data/gameRooms`, roomIdInput);

        try {
            const docSnap = await getDoc(roomRef);
            if (!docSnap.exists()) {
                setMessage(`Room '${roomIdInput}' does not exist.`);
                return;
            }

            const data = docSnap.data();
            const playerExists = data.players.some(p => p.id === userId);

            // Only allow joining if game is in lobby state
            if (data.status !== 'lobby') {
                setMessage("Cannot join: Game has already started or ended.");
                return;
            }

            if (!playerExists) {
                const updatedPlayers = [...data.players, { id: userId, username: usernameInput.trim(), score: 0, lives: 2 }]; // Store username
                await updateDoc(roomRef, { players: updatedPlayers });
            }
            setCurrentRoomId(roomIdInput);
            setCurrentScreen('game');
            setMessage(`Joined room '${roomIdInput}'.`);
        } catch (error) {
            console.error("Error joining room:", error);
            setMessage(`Failed to join room: ${error.message}`);
        }
    };

    // Function to start the game (only host can do this)
    const startGame = async () => {
        if (!db || !userId || !currentRoomId || !gameData) {
            setMessage("Cannot start game. Missing data.");
            return;
        }
        if (gameData.hostId !== userId) {
            setMessage("Only the host can start the game.");
            return;
        }
        if (gameData.players.length < 1) { // Minimum 1 player for now, can be changed to 2+
            setMessage("Need at least one player to start the game.");
            return;
        }

        try {
            const roomRef = doc(db, `artifacts/${typeof __app_id !== 'undefined' ? __app_id : 'default-app-id'}/public/data/gameRooms`, currentRoomId);
            const initialLetters = await generateLettersWithLLM(); // Use LLM for initial letters

            await updateDoc(roomRef, {
                status: 'in-game',
                currentLetters: initialLetters,
                activePlayerId: gameData.players[0].id, // Start with the first player
                timerEndTime: Date.now() + 15 * 1000, // 15 seconds per turn
                wordHistory: [],
                // Ensure all players start with 2 lives if somehow not set
                players: gameData.players.map(p => ({ ...p, lives: p.lives === undefined ? 2 : p.lives })),
            });
            setMessage("Game started!");
        } catch (error) {
            console.error("Error starting game:", error);
            setMessage(`Failed to start game: ${error.message}`);
        }
    };

    // Helper to check if letters are present consecutively and in order
    const areLettersConsecutiveAndOrdered = (word, requiredLetters) => {
        return word.includes(requiredLetters);
    };

    // Word submission logic
    const submitWord = async () => {
        if (!db || !userId || !currentRoomId || !gameData || gameData.status !== 'in-game' || gameData.activePlayerId !== userId) {
            setMessage("It's not your turn or game not active.");
            return;
        }

        const submittedWord = wordInput.trim().toLowerCase(); // Convert to lowercase for dictionary check
        const requiredLetters = gameData.currentLetters.toLowerCase();

        if (!submittedWord) {
            setMessage("Please enter a word.");
            return;
        }

        const roomRef = doc(db, `artifacts/${typeof __app_id !== 'undefined' ? __app_id : 'default-app-id'}/public/data/gameRooms`, currentRoomId);
        let updatedPlayers = [...gameData.players];
        let currentPlayerIndex = updatedPlayers.findIndex(p => p.id === userId);

        // If current player somehow has no lives, prevent them from submitting
        if (updatedPlayers[currentPlayerIndex] && updatedPlayers[currentPlayerIndex].lives <= 0) {
            setMessage("У тебя нет жизней для участия в этом ходу.");
            setWordInput('');
            return;
        }

        // 1. Dictionary Check
        const isValidWord = await checkWordInDictionary(submittedWord);
        if (!isValidWord) {
            setMessage(`'${submittedWord}' не является действительным русским словом.`);
            updatedPlayers[currentPlayerIndex].lives = Math.max(0, updatedPlayers[currentPlayerIndex].lives - 1); // Lose a life
            setWordInput('');
            await advanceTurn(roomRef, updatedPlayers, `Слово не в словаре. ${updatedPlayers[currentPlayerIndex].lives} жизней осталось.`);
            return;
        }

        // 2. Consecutive and Ordered Letters Check
        if (!areLettersConsecutiveAndOrdered(submittedWord, requiredLetters)) {
            setMessage(`Слово '${submittedWord}' должно содержать '${gameData.currentLetters}' последовательно и в том же порядке.`);
            updatedPlayers[currentPlayerIndex].lives = Math.max(0, updatedPlayers[currentPlayerIndex].lives - 1); // Lose a life
            setWordInput('');
            await advanceTurn(roomRef, updatedPlayers, `Неправильные буквы. ${updatedPlayers[currentPlayerIndex].lives} жизней осталось.`);
            return;
        }

        // 3. Check if word has already been used in this game
        if (gameData.wordHistory.includes(submittedWord)) {
            setMessage(`Слово '${submittedWord}' уже было использовано.`);
            updatedPlayers[currentPlayerIndex].lives = Math.max(0, updatedPlayers[currentPlayerIndex].lives - 1); // Lose a life
            setWordInput('');
            await advanceTurn(roomRef, updatedPlayers, `Слово уже использовано. ${updatedPlayers[currentPlayerIndex].lives} жизней осталось.`);
            return;
        }

        // If all validations pass
        updatedPlayers[currentPlayerIndex].score += submittedWord.length;
        setWordInput('');
        await advanceTurn(roomRef, updatedPlayers, `Слово '${submittedWord}' принято!`, submittedWord);
    };

    // Advance turn helper function
    const advanceTurn = async (roomRef, currentPlayers, msg, submittedWord = null) => {
        let playersWithLives = currentPlayers.filter(p => p.lives > 0);

        if (playersWithLives.length <= 1) {
            // Game Over
            const winner = playersWithLives.length === 1 ? playersWithLives[0].id : null;
            const winnerUsername = winner ? getUsernameById(winner, currentPlayers) : null;
            await updateDoc(roomRef, {
                status: 'game-over',
                players: currentPlayers, // Update scores/lives
                activePlayerId: null,
                timerEndTime: null,
                message: winner ? `${winnerUsername} won the game!` : 'Game ended with no clear winner.'
            });
            setMessage(winner ? `Игра окончена! ${winner === userId ? 'Ты' : winnerUsername} победил(а)!` : 'Игра окончена! Нет победителя.');
            return;
        }

        // Determine next active player from those still having lives
        const currentPlayerIndex = currentPlayers.findIndex(p => p.id === gameData.activePlayerId);
        let nextPlayerIndex = (currentPlayerIndex + 1) % currentPlayers.length;
        let nextActivePlayer = currentPlayers[nextPlayerIndex];

        // Skip players with 0 lives
        let attempts = 0;
        const maxAttempts = currentPlayers.length; // Prevent infinite loop if all players are out
        while (nextActivePlayer.lives <= 0 && attempts < maxAttempts) {
            nextPlayerIndex = (nextPlayerIndex + 1) % currentPlayers.length;
            nextActivePlayer = currentPlayers[nextPlayerIndex];
            attempts++;
        }

        if (attempts >= maxAttempts && nextActivePlayer.lives <= 0) {
            // This case should be caught by playersWithLives.length <= 1 above, but as a safeguard.
            await updateDoc(roomRef, {
                status: 'game-over',
                players: currentPlayers,
                activePlayerId: null,
                timerEndTime: null,
                message: 'Game ended with no active players.'
            });
            setMessage('Игра окончена! Нет активных игроков.');
            return;
        }

        const newLetters = await generateLettersWithLLM(); // Generate new letters for next turn

        await updateDoc(roomRef, {
            players: currentPlayers, // Update scores/lives from validation
            wordHistory: submittedWord ? [...gameData.wordHistory, submittedWord] : gameData.wordHistory,
            currentLetters: newLetters,
            activePlayerId: nextActivePlayer.id,
            timerEndTime: Date.now() + 15 * 1000, // Reset timer for next player
        });
        setMessage(msg);
    };

    // Timer logic
    const [timeLeft, setTimeLeft] = useState(0);
    useEffect(() => {
        if (gameData && gameData.status === 'in-game' && gameData.timerEndTime) {
            const timerInterval = setInterval(() => {
                const remaining = Math.max(0, Math.floor((gameData.timerEndTime - Date.now()) / 1000));
                setTimeLeft(remaining);

                if (remaining === 0) {
                    clearInterval(timerInterval);
                    // Time's up logic: only current player handles time's up
                    if (gameData.activePlayerId === userId) {
                        handleTurnEndOnTimeout();
                    }
                }
            }, 1000);
            return () => clearInterval(timerInterval);
        } else {
            setTimeLeft(0); // Reset timer display if game is not in-game or no timer set
        }
    }, [gameData, userId]);

    const handleTurnEndOnTimeout = async () => {
        if (!db || !currentRoomId || !gameData || gameData.status !== 'in-game' || gameData.activePlayerId !== userId) return;

        try {
            const roomRef = doc(db, `artifacts/${typeof __app_id !== 'undefined' ? __app_id : 'default-app-id'}/public/data/gameRooms`, currentRoomId);
            let updatedPlayers = [...gameData.players];
            let currentPlayerIndex = updatedPlayers.findIndex(p => p.id === userId);

            if (currentPlayerIndex !== -1) {
                updatedPlayers[currentPlayerIndex].lives = Math.max(0, updatedPlayers[currentPlayerIndex].lives - 1); // Lose a life
                setMessage(`Время вышло! ${updatedPlayers[currentPlayerIndex].lives} жизней осталось.`);
            }

            const currentUsername = getUsernameById(userId, updatedPlayers);
            await advanceTurn(roomRef, updatedPlayers, `Время вышло! ${currentUsername} потерял(а) жизнь.`);
        } catch (error) {
            console.error("Error handling timeout:", error);
            setMessage(`Error handling timeout: ${error.message}`);
        }
    };


    // Helper to get username by ID from gameData.players
    const getUsernameById = (id, playersArray) => {
        const player = playersArray.find(p => p.id === id);
        return player ? player.username : `Гость-${id.substring(0, 5)}`; // Fallback for old data or missing username
    };

    // Render based on current screen
    const renderContent = () => {
        if (!isAuthReady || !userId || !db) {
            return (
                <div className="flex justify-center items-center h-screen bg-gray-900">
                    <p className="text-white text-xl">Инициализация приложения и аутентификация...</p>
                </div>
            );
        }

        return (
            <div className="font-sans">
                {/* Tailwind CSS CDN */}
                <script src="https://cdn.tailwindcss.com"></script>
                {currentScreen === 'lobby' && (
                    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-blue-900 to-indigo-900 text-white p-4">
                        <h1 className="text-5xl font-extrabold mb-8 text-yellow-300 drop-shadow-lg">
                            Русский Словесный Бум!
                        </h1>
                        <p className="text-lg mb-6 text-gray-300 text-center">
                            Твоя цель: составить слово, содержащее заданные буквы.<br/>
                            Буквы должны идти последовательно и в том же порядке.
                        </p>
                        <div className="w-full max-w-md bg-gray-800 rounded-xl shadow-2xl p-8 transform transition duration-300 hover:scale-105">
                            <h2 className="text-3xl font-bold mb-6 text-center text-blue-300">Присоединиться или Создать Комнату</h2>
                            <p className="text-sm text-gray-400 mb-4 text-center">Твой ID: <span className="font-mono bg-gray-700 px-2 py-1 rounded-md text-sm">{userId}</span></p>

                            <div className="mb-4"> {/* New username input */}
                                <label htmlFor="username" className="block text-gray-300 text-sm font-bold mb-2">Твое Имя:</label>
                                <input
                                    type="text"
                                    id="username"
                                    className="shadow-inner appearance-none border rounded-lg w-full py-3 px-4 text-gray-900 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-200"
                                    placeholder="Например, 'Игрок1'"
                                    value={usernameInput}
                                    onChange={(e) => setUsernameInput(e.target.value)}
                                    maxLength="15" // Limit username length
                                />
                            </div>

                            <div className="mb-6">
                                <label htmlFor="room-id" className="block text-gray-300 text-sm font-bold mb-2">Название Комнаты:</label>
                                <input
                                    type="text"
                                    id="room-id"
                                    className="shadow-inner appearance-none border rounded-lg w-full py-3 px-4 text-gray-900 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-200"
                                    placeholder="Например, 'моя-игра'"
                                    value={roomIdInput}
                                    onChange={(e) => setRoomIdInput(e.target.value)}
                                />
                            </div>

                            <div className="flex flex-col space-y-4">
                                <button
                                    onClick={createRoom}
                                    className="bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-lg shadow-lg transform transition duration-200 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-gray-800"
                                >
                                    Создать Комнату
                                </button>
                                <button
                                    onClick={joinRoom}
                                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg shadow-lg transform transition duration-200 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800"
                                >
                                    Присоединиться к Комнате
                                </button>
                            </div>
                        </div>
                        {message && <p className="mt-6 text-yellow-400 text-md font-semibold bg-gray-800 p-3 rounded-lg shadow-lg text-center max-w-md w-full">{message}</p>}
                    </div>
                )}

                {currentScreen === 'game' && gameData && (
                    <div className="flex flex-col items-center justify-start min-h-screen bg-gradient-to-br from-purple-900 to-pink-900 text-white p-4">
                        <h1 className="text-4xl md:text-5xl font-extrabold mb-4 text-yellow-300 drop-shadow-lg text-center">
                            Комната: {currentRoomId}
                        </h1>
                        <p className="text-md md:text-lg mb-4 text-gray-300 text-center">
                            Твой ID: <span className="font-mono bg-gray-700 px-2 py-1 rounded-md text-sm">{userId}</span>
                        </p>

                        <div className="w-full max-w-4xl bg-gray-800 rounded-xl shadow-2xl p-6 md:p-8 flex flex-col md:flex-row gap-6 mb-6">
                            {/* Scoreboard */}
                            <div className="md:w-1/3 bg-gray-700 rounded-lg p-4 shadow-inner">
                                <h2 className="text-2xl font-bold mb-4 text-blue-300">Игроки</h2>
                                <ul className="space-y-2">
                                    {gameData.players.map(player => (
                                        <li key={player.id} className={`flex justify-between items-center p-2 rounded-md ${player.id === gameData.activePlayerId ? 'bg-indigo-500 text-white scale-105' : 'bg-gray-600'} transition-all duration-300 ${player.lives === 0 ? 'opacity-50 line-through' : ''}`}>
                                            <span className="font-semibold">{player.id === userId ? 'Ты' : player.username || `Гость-${player.id.substring(0,5)}`}</span> {/* Display username */}
                                            <div className="flex items-center space-x-2">
                                                <span className="font-bold text-lg">{player.score}</span>
                                                <span className="text-sm px-2 py-1 rounded-full bg-red-500 text-white">❤️ {player.lives}</span>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            </div>

                            {/* Game Area */}
                            <div className="md:w-2/3 flex flex-col justify-between">
                                {gameData.status === 'lobby' ? (
                                    <div className="flex flex-col items-center justify-center h-full">
                                        <p className="text-xl text-center mb-6">Ожидание начала игры...</p>
                                        {gameData.hostId === userId && gameData.players.length >= 1 && (
                                            <button
                                                onClick={startGame}
                                                className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 px-6 rounded-lg shadow-lg transform transition duration-200 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-gray-800"
                                                disabled={isGeneratingLetters}
                                            >
                                                {isGeneratingLetters ? 'Генерация букв...' : 'Начать Игру'}
                                            </button>
                                        )}
                                        {gameData.hostId !== userId && (
                                            <p className="text-gray-400 text-sm mt-4">Только хост ({getUsernameById(gameData.hostId, gameData.players)}) может начать игру.</p>
                                        )}
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center">
                                        <p className="text-lg md:text-xl font-semibold mb-2 text-gray-300">
                                            Ход игрока: <span className="font-bold text-yellow-300">
                                                {gameData.activePlayerId === userId ? 'Твой ход!' : getUsernameById(gameData.activePlayerId, gameData.players)}
                                            </span>
                                        </p>
                                        {isGeneratingLetters ? (
                                            <div className="text-4xl md:text-5xl text-gray-400 animate-pulse mb-6">Загрузка букв...</div>
                                        ) : (
                                            <div className="text-7xl md:text-8xl font-black mb-6 text-green-400 tracking-wider">
                                                {gameData.currentLetters}
                                            </div>
                                        )}
                                        <p className="text-xl md:text-2xl font-bold text-red-400 mb-4">
                                            Время: {timeLeft} сек
                                        </p>

                                        {gameData.activePlayerId === userId && gameData.players.find(p => p.id === userId)?.lives > 0 ? (
                                            <div className="w-full flex flex-col md:flex-row gap-3">
                                                <input
                                                    type="text"
                                                    className="flex-grow shadow-inner appearance-none border rounded-lg w-full py-3 px-4 text-gray-900 leading-tight focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-200 text-center text-xl uppercase"
                                                    placeholder="Введи слово здесь"
                                                    value={wordInput}
                                                    onChange={(e) => setWordInput(e.target.value)}
                                                    onKeyPress={(e) => {
                                                        if (e.key === 'Enter') {
                                                            submitWord();
                                                        }
                                                    }}
                                                    autoFocus
                                                    disabled={isGeneratingLetters || isCheckingWord}
                                                />
                                                <button
                                                    onClick={submitWord}
                                                    className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-6 rounded-lg shadow-lg transform transition duration-200 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-800 flex-shrink-0"
                                                    disabled={isGeneratingLetters || isCheckingWord}
                                                >
                                                    {isCheckingWord ? 'Проверка...' : 'Отправить'}
                                                </button>
                                            </div>
                                        ) : (
                                            <p className="text-gray-400 text-md mt-4">
                                                {gameData.activePlayerId === userId && gameData.players.find(p => p.id === userId)?.lives === 0
                                                    ? "У тебя нет жизней. Жди окончания игры."
                                                    : "Ожидание хода другого игрока..."}
                                            </p>
                                        )}

                                        {message && (
                                            <p className="mt-4 text-yellow-400 text-md font-semibold bg-gray-700 p-3 rounded-lg shadow-lg w-full text-center">{message}</p>
                                        )}

                                        <div className="mt-6 w-full bg-gray-700 rounded-lg p-4 shadow-inner">
                                            <h3 className="text-xl font-bold mb-3 text-cyan-300">Использованные Слова:</h3>
                                            <div className="max-h-40 overflow-y-auto text-gray-300 text-sm">
                                                {gameData.wordHistory.length === 0 ? (
                                                    <p>Пока нет использованных слов.</p>
                                                ) : (
                                                    <ul className="list-disc list-inside space-y-1">
                                                        {gameData.wordHistory.map((word, index) => (
                                                            <li key={index}>{word}</li>
                                                        ))}
                                                    </ul>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {currentScreen === 'game-over' && gameData && (
                    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-red-900 to-orange-900 text-white p-4">
                        <h1 className="text-5xl font-extrabold mb-8 text-yellow-300 drop-shadow-lg">
                            Игра Окончена!
                        </h1>
                        <div className="w-full max-w-md bg-gray-800 rounded-xl shadow-2xl p-8 transform transition duration-300 hover:scale-105">
                            <h2 className="text-3xl font-bold mb-6 text-center text-blue-300">Результаты:</h2>
                            <ul className="space-y-3 mb-6">
                                {gameData.players.sort((a, b) => b.score - a.score).map(player => (
                                    <li key={player.id} className="flex justify-between items-center bg-gray-700 p-3 rounded-md shadow-md">
                                        <span className="font-semibold text-lg">{player.id === userId ? 'Ты' : player.username || `Гость-${player.id.substring(0,5)}`}</span> {/* Display username */}
                                        <div className="flex items-center space-x-2">
                                            <span className="font-bold text-2xl text-green-400">{player.score} очков</span>
                                            <span className="text-sm px-2 py-1 rounded-full bg-red-500 text-white">❤️ {player.lives}</span>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                            <button
                                onClick={() => {
                                    setCurrentScreen('lobby');
                                    setCurrentRoomId(null);
                                    setGameData(null);
                                    setRoomIdInput('');
                                    setMessage('');
                                }}
                                className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg shadow-lg w-full transform transition duration-200 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800"
                            >
                                Вернуться в Лобби
                            </button>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    return renderContent();
};

export default App;
