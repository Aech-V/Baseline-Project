import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, getDocs, collection, addDoc, serverTimestamp, onSnapshot, query, orderBy, limit, deleteDoc, updateDoc, increment, arrayUnion } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged, updateProfile, deleteUser } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";

// ==========================================
// FIREBASE CONFIGURATION & INITIALIZATION
// ==========================================
const firebaseConfig = {
    apiKey: "AIzaSyBnZcndzgxlpo0QN2xthcRhSI84ZGsAwig",
    authDomain: "habit-tracker-project-f7559.firebaseapp.com",
    projectId: "habit-tracker-project-f7559",
    storageBucket: "habit-tracker-project-f7559.firebasestorage.app",
    messagingSenderId: "480017883950",
    appId: "1:480017883950:web:7c3e4fe0b1de94f79890bf"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

// ==========================================
// SSO REDIRECT HANDLER
// ==========================================
// This catches the user returning from the Google login page
getRedirectResult(auth).then(async (result) => {
    if (result) {
        // User successfully signed in via redirect
        await createBaselineProfile(result.user, "google_sso");
    }
}).catch((error) => {
    console.error("SSO Redirect Error:", error);
    const regGlobalError = document.getElementById('reg-globalError');
    const loginGlobalError = document.getElementById('login-globalError');
    showGlobalError(regGlobalError, "Google Sign-In failed.");
    showGlobalError(loginGlobalError, "Google Sign-In failed.");
});

// ==========================================
// STATE MANAGEMENT & GLOBALS
// ==========================================
const CACHE_KEY_ICON = "baseline_brand_icon_url";
const CACHE_KEY_VISITED = "baseline_has_visited";

let activeHabitsMap = {};
let currentOpenHabitId = null;
let globalUserId = null;
let isFirstBoot = true;

// Timeline & Alerts State
let timelineLimit = 15; 
let currentTimelineUnsub = null; 
let systemAlerts = []; 
let currentlyEditingLogId = null;

// Focus Engine State
let focusInterval;
let focusPhases = [];
let currentPhaseIndex = 0;
let timeRemaining = 0;
let isPaused = false;
let totalMinutesLogged = 0;
let cachedFocusSettings = { work: 25, rest: 5 };
let expectedEndTime = 0;
let phaseMinutesLogged = 0;
let activeFocusHabitId = null;

const habitIcons = [
    "🎯", "✍️", "🐪", "📈", "👏", "🏃‍♂️", "💧", "📚", 
    "🧘‍♀️", "🍎", "🏋️", "🛌", "💻", "🧠", "🎨", "🎵",
    "💊", "🚭", "🥦", "🚿", "🚶", "🚴", "💰", "🧹", 
    "🌿", "☕", "📖", "📱", "📵", "🌞", "🌙", "🔥", 
    "⚡", "⭐", "💪", "🧗", "🛠️", "🌱", "🧘‍♂️"
];

const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

// ==========================================
// UTILITY ENGINE
// ==========================================
function isMobileDevice() {
    const userAgentMatch = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const isSmallScreen = window.innerWidth <= 768;
    return userAgentMatch || isSmallScreen;
}

function switchMasterView(targetViewId) {
    const mainViews = ['splash-view', 'register-view', 'login-view', 'dashboard-shell'];
    mainViews.forEach(viewId => {
        const el = document.getElementById(viewId);
        if (el) {
            el.classList.add('d-none');
            el.classList.remove('fade-in');
        }
    });

    const target = document.getElementById(targetViewId);
    if (target) {
        target.classList.remove('d-none');
        if (targetViewId !== 'dashboard-shell') target.classList.add('fade-in');
    }
}

function getLocalDateString(dateObj = new Date()) {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatTimeDisplay(hour, minute) {
    const h = hour.toString().padStart(2, '0');
    const m = minute.toString().padStart(2, '0');
    return { h, m };
}

function formatTimelineDate(timestamp) {
    if (!timestamp) return "Unknown time";
    const dateObj = typeof timestamp.toDate === 'function' ? timestamp.toDate() : new Date(timestamp);
    const options = { weekday: 'long', hour: 'numeric', minute: '2-digit' };
    return dateObj.toLocaleDateString('en-US', options);
}

function toggleVisibility(inputElement, buttonElement) {
    if (inputElement.type === "password") {
        inputElement.type = "text";
        buttonElement.classList.add('is-revealed');
    } else {
        inputElement.type = "password";
        buttonElement.classList.remove('is-revealed');
    }
}

function showGlobalError(element, message) {
    if (element) {
        element.textContent = message;
        element.style.display = "block";
    }
}

function resetSubmitButton(btnElement, originalText) {
    if (btnElement) {
        btnElement.textContent = originalText;
        btnElement.disabled = false;
        btnElement.style.opacity = "1";
        btnElement.style.cursor = "pointer";
        btnElement.style.backgroundColor = "var(--cyber-yellow)";
        btnElement.style.color = "var(--bg-deep-space)";
    }
}

// ==========================================
// SMART PROTOCOL TRACKING LOGIC
// ==========================================
function isHabitPendingToday(habit) {
    if (habit.status !== "active") return false;
    
    const todayStr = getLocalDateString();
    const completedDates = habit.completedDates || [];
    
    if (completedDates.includes(todayStr)) return false;

    const freq = habit.frequency || { type: 'every_day', target: 1 };

    if (freq.type === 'every_day') {
        return true; 
    } 
    else if (freq.type === 'every_x_days') {
        if (completedDates.length === 0) return true; 
        const lastDateStr = completedDates[completedDates.length - 1];
        const lastDate = new Date(lastDateStr);
        const daysSince = Math.floor((new Date() - lastDate) / (1000 * 60 * 60 * 24));
        return daysSince >= freq.target;
    }
    else if (freq.type === 'times_per_week') {
        let completionsLast7Days = 0;
        for (let i = 0; i < 7; i++) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            if (completedDates.includes(getLocalDateString(d))) completionsLast7Days++;
        }
        return completionsLast7Days < freq.target;
    }
    else if (freq.type === 'times_per_month') {
        let completionsLast30Days = 0;
        for (let i = 0; i < 30; i++) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            if (completedDates.includes(getLocalDateString(d))) completionsLast30Days++;
        }
        return completionsLast30Days < freq.target;
    }
    return true; 
}

function isCompletedToday(timestamp) {
    if (!timestamp) return false;
    const dateObj = typeof timestamp.toDate === 'function' ? timestamp.toDate() : new Date(timestamp);
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return dateObj > midnight;
}

function isStreakBroken(lastCompletedAt) {
    if (!lastCompletedAt) return false; 
    const dateObj = typeof lastCompletedAt.toDate === 'function' ? lastCompletedAt.toDate() : new Date(lastCompletedAt);
    const lastCompleteMidnight = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate()).getTime();
    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const diffInDays = (todayMidnight - lastCompleteMidnight) / (1000 * 60 * 60 * 24);
    return diffInDays >= 2;
}

// ==========================================
// SPLASH & INITIALIZATION ENGINE
// ==========================================
function runSplashAnimation(isAuthenticated) {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
        gsap.to(["#logo-wrap", "#brand-text"], { opacity: 1, duration: 1, delay: 0.2 });
        gsap.to("#logo-active", { clipPath: "inset(0% 0 0 0)", duration: 0.1 });
        setTimeout(() => {
            if (isAuthenticated) {
                switchMasterView('dashboard-shell');
            } else {
                const hasVisited = localStorage.getItem(CACHE_KEY_VISITED);
                if (hasVisited === "true") {
                    switchMasterView('login-view');
                } else {
                    localStorage.setItem(CACHE_KEY_VISITED, "true");
                    switchMasterView('register-view');
                }
            }
        }, 1500);
        return; 
    }

    const tl = gsap.timeline({ 
        delay: 0.2,
        onComplete: () => {
            gsap.to("#splash-view", { 
                opacity: 0, 
                duration: 0.4, 
                onComplete: () => {
                    if (isAuthenticated) {
                        switchMasterView('dashboard-shell');
                    } else {
                        const hasVisited = localStorage.getItem(CACHE_KEY_VISITED);
                        if (hasVisited === "true") {
                            switchMasterView('login-view');
                        } else {
                            localStorage.setItem(CACHE_KEY_VISITED, "true");
                            switchMasterView('register-view');
                        }
                    }
                } 
            });
        }
    });

    tl.to("#logo-wrap", { scale: 1, opacity: 1, duration: 0.2, ease: "power3.out" })
      .to("#logo-active", { clipPath: "inset(0% 0 0 0)", duration: 0.4, ease: "none" }, "+=0")
      .to("#logo-active", { filter: "drop-shadow(0px 0px 40px rgba(212, 255, 0, 0.8))", duration: 0.1, ease: "power1.inOut" }, "-=0.0")
      .to("#bg-circuitry", { opacity: 0.15, duration: 0.15, yoyo: true, repeat: 1 }, "<")
      .to("#logo-active", { filter: "drop-shadow(0px 0px 15px rgba(212, 255, 0, 0.4))", duration: 0.7, ease: "power2.out" }, "+=0")
      .to("#brand-text", { y: 0, opacity: 1, duration: 0.7, ease: "power3.out" }, "<");
}

function applyImageAndAnimate(iconUrl, isAuthenticated) {
    const icons = document.querySelectorAll('.brand-icon');
    const imagePreloader = new Image();
    imagePreloader.src = iconUrl;

    imagePreloader.onload = () => {
        icons.forEach(img => {
            img.src = iconUrl;
            img.style.opacity = 1;
            img.style.display = 'block';
        });
        runSplashAnimation(isAuthenticated);
    };
    imagePreloader.onerror = () => runSplashAnimation(isAuthenticated);
}

async function fetchIconAndInitialize(isAuthenticated) {
    try {
        const cachedIconUrl = localStorage.getItem(CACHE_KEY_ICON);
        if (cachedIconUrl) {
            applyImageAndAnimate(cachedIconUrl, isAuthenticated);
            return; 
        }
        const docRef = doc(db, "Branding", "Assets");
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const iconUrl = docSnap.data().brandIcon; 
            localStorage.setItem(CACHE_KEY_ICON, iconUrl);
            applyImageAndAnimate(iconUrl, isAuthenticated);
        } else {
            runSplashAnimation(isAuthenticated);
        }
    } catch (error) {
        console.error("Initialization Error:", error);
        runSplashAnimation(isAuthenticated);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const savedTheme = localStorage.getItem('baseline_theme');
    if (savedTheme === 'light') {
        document.body.classList.add('light-mode');
        const themeToggle = document.getElementById('themeToggleSwitch');
        if (themeToggle) themeToggle.checked = true;
    }

    const settingTimezone = document.getElementById('settingTimezone');
    if (settingTimezone) settingTimezone.value = Intl.DateTimeFormat().resolvedOptions().timeZone;
    
    const savedWork = localStorage.getItem('baseline_focus_work');
    const savedRest = localStorage.getItem('baseline_focus_rest');
    
    if (savedWork && document.getElementById('settingFocusWork')) document.getElementById('settingFocusWork').value = savedWork;
    if (savedRest && document.getElementById('settingFocusRest')) document.getElementById('settingFocusRest').value = savedRest;

    if (savedWork && !isNaN(parseInt(savedWork))) cachedFocusSettings.work = parseInt(savedWork);
    if (savedRest && !isNaN(parseInt(savedRest))) cachedFocusSettings.rest = parseInt(savedRest);

    let savedView = localStorage.getItem('baseline_active_view') || 'mainDashboard';
    document.querySelector(`.nav-item[data-target="${savedView}"]`)?.click(); 
});

// ==========================================
// AUTHENTICATION & USER MANAGEMENT
// ==========================================
onAuthStateChanged(auth, async (user) => {
    if (user) {
        globalUserId = user.uid;
        
        if (isFirstBoot) {
            fetchIconAndInitialize(true);
            isFirstBoot = false;
        } else {
            switchMasterView('dashboard-shell');
        }
        
        const cachedHabits = localStorage.getItem(`baseline_cache_${globalUserId}`);
        if (cachedHabits) {
            try {
                activeHabitsMap = JSON.parse(cachedHabits);
                renderDashboardUI();
            } catch(e) { 
                console.error("Cache parsing failed", e); 
            }
        }

        initializeRealTimeHabits(user);
        initializeExecutionTimeline(user);

        const displayName = user.displayName || user.email.split('@')[0];
        const userGreeting = document.getElementById('userGreeting');
        if (userGreeting) userGreeting.textContent = `Welcome, ${displayName}.`;
        
        const settingsEmailInput = document.getElementById('settingsEmailInput');
        if (settingsEmailInput) settingsEmailInput.value = user.email;

        const userRef = doc(db, "Users", user.uid);
        const docSnap = await getDoc(userRef);
        
        if (docSnap.exists()) {
            const userData = docSnap.data();
            const settingsNameInput = document.getElementById('settingsNameInput');
            if (settingsNameInput) settingsNameInput.value = userData.displayName || "";
            
            if (userData.settings) {
                const settingStartOfWeek = document.getElementById('settingStartOfWeek');
                const notifyMorningToggle = document.getElementById('notifyMorningToggle');
                const notifyWeeklyToggle = document.getElementById('notifyWeeklyToggle');

                if (userData.settings.startOfWeek && settingStartOfWeek) {
                    settingStartOfWeek.value = userData.settings.startOfWeek;
                    localStorage.setItem('baseline_start_of_week', userData.settings.startOfWeek);
                }
                if (userData.settings.notifyMorning !== undefined && notifyMorningToggle) {
                    notifyMorningToggle.checked = userData.settings.notifyMorning;
                }
                if (userData.settings.notifyWeekly !== undefined && notifyWeeklyToggle) {
                    notifyWeeklyToggle.checked = userData.settings.notifyWeekly;
                }
            }
        }
    } else {
        globalUserId = null;
        if (isFirstBoot) {
            fetchIconAndInitialize(false);
            isFirstBoot = false;
        } else {
            switchMasterView('login-view');
        }
    }
});

async function createBaselineProfile(user, providerName) {
    const userRef = doc(db, "Users", user.uid);
    const docSnap = await getDoc(userRef);
    if (docSnap.exists()) return; 

    const profileData = {
        uid: user.uid,
        email: user.email,
        authProvider: providerName,
        accountCreated: serverTimestamp(),
        settings: { theme: "dark", notificationsEnabled: true },
        stats: { currentStreak: 0, totalHabitsTracked: 0 }
    };
    await setDoc(userRef, profileData);
}

// ==========================================
// AUTHENTICATION UI BINDINGS
// ==========================================
document.querySelector('.switch-to-login')?.addEventListener('click', (e) => {
    e.preventDefault();
    switchMasterView('login-view');
});

document.querySelector('.switch-to-register')?.addEventListener('click', (e) => {
    e.preventDefault();
    switchMasterView('register-view');
});

// Registration Elements
const regEmailInput = document.getElementById('reg-emailInput');
const regEmailCheckmark = document.getElementById('reg-emailCheckmark');
const regPasswordInput = document.getElementById('reg-passwordInput');
const regToggleBtn = document.getElementById('reg-togglePasswordBtn');
const regPassCheckmark = document.getElementById('reg-passwordCheckmark');
const regMeterContainer = document.getElementById('reg-meterContainer');
const regStrengthLabel = document.getElementById('reg-strengthLabel');
const regErrorMsg = document.getElementById('reg-passwordError');
const segments = [
    document.getElementById('seg-1'), document.getElementById('seg-2'),
    document.getElementById('seg-3'), document.getElementById('seg-4')
];
const rules = [/.{8,}/, /(?=.*[a-z])(?=.*[A-Z])/, /(?=.*\d)/, /(?=.*[@$!%*?&._-])/];
const regConfirmInput = document.getElementById('reg-passwordConfirm');
const regConfirmCheckmark = document.getElementById('reg-confirmCheckmark');
const regToggleConfirmBtn = document.getElementById('reg-toggleConfirmBtn');
let isPasswordMatch = false;

regEmailInput?.addEventListener('input', (e) => {
    if (emailRegex.test(e.target.value)) regEmailCheckmark?.classList.add('active');
    else regEmailCheckmark?.classList.remove('active');
});

regToggleBtn?.addEventListener('click', () => toggleVisibility(regPasswordInput, regToggleBtn));
regToggleConfirmBtn?.addEventListener('click', () => toggleVisibility(regConfirmInput, regToggleConfirmBtn));

regPasswordInput?.addEventListener('focus', () => {
    if (regMeterContainer) regMeterContainer.style.display = 'flex';
});

regPasswordInput?.addEventListener('input', (e) => {
    const val = e.target.value;
    let score = 0;

    if (val.length === 0) {
        segments.forEach(seg => { if(seg) seg.className = 'strength-segment'; });
        if (regStrengthLabel) {
            regStrengthLabel.className = 'strength-label';
            regStrengthLabel.textContent = "Awaiting input...";
        }
        regPassCheckmark?.classList.remove('active');
        if (regErrorMsg) regErrorMsg.style.display = "none";
        return;
    }

    rules.forEach(rule => { if (rule.test(val)) score++; });

    if (score === 4) regPassCheckmark?.classList.add('active');
    else regPassCheckmark?.classList.remove('active');

    segments.forEach(seg => { if(seg) seg.className = 'strength-segment'; });
    if (regStrengthLabel) regStrengthLabel.className = 'strength-label';

    if (score === 1 && segments[0]) { segments[0].classList.add('segment-weak'); if (regStrengthLabel) regStrengthLabel.textContent = "Weak"; }
    else if (score === 2 && segments[1]) { segments[0].classList.add('segment-fair'); segments[1].classList.add('segment-fair'); if (regStrengthLabel) regStrengthLabel.textContent = "Fair"; }
    else if (score === 3 && segments[2]) { segments[0].classList.add('segment-good'); segments[1].classList.add('segment-good'); segments[2].classList.add('segment-good'); if (regStrengthLabel) regStrengthLabel.textContent = "Good"; }
    else if (score === 4 && segments[0]) { segments.forEach(seg => { if(seg) seg.classList.add('segment-optimal'); }); if (regStrengthLabel) { regStrengthLabel.textContent = "Optimal"; regStrengthLabel.classList.add('label-optimal'); } }

    if (!rules[0].test(val)) showGlobalError(regErrorMsg, "8+ characters required.");
    else if (!rules[1].test(val)) showGlobalError(regErrorMsg, "Upper and lowercase required.");
    else if (!rules[2].test(val)) showGlobalError(regErrorMsg, "Number required.");
    else if (!rules[3].test(val)) showGlobalError(regErrorMsg, "Special character required.");
    else if (regErrorMsg) regErrorMsg.style.display = "none";
});

function validateMatch() {
    if (!regPasswordInput || !regConfirmInput) return;
    const pass1 = regPasswordInput.value;
    const pass2 = regConfirmInput.value;
    if (pass1 === pass2 && pass1.length > 0) {
        regConfirmCheckmark?.classList.add('active');
        isPasswordMatch = true;
    } else {
        regConfirmCheckmark?.classList.remove('active');
        isPasswordMatch = false;
    }
}

regPasswordInput?.addEventListener('input', validateMatch);
regConfirmInput?.addEventListener('input', validateMatch);

const regForm = document.getElementById('reg-Form');
const regSubmitBtn = document.getElementById('reg-submitBtn');
const regGlobalError = document.getElementById('reg-globalError');

regForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (regGlobalError) regGlobalError.style.display = "none";

    const emailVal = regEmailInput.value;
    const passVal = regPasswordInput.value;

    let finalScore = 0;
    rules.forEach(rule => { if (rule.test(passVal)) finalScore++; });

    if (!emailRegex.test(emailVal) || finalScore !== 4 || !isPasswordMatch) {
        showGlobalError(regGlobalError, "Please fix the highlighted errors above.");
        return;
    }

    const originalText = regSubmitBtn.textContent;
    regSubmitBtn.textContent = "Calibrating...";
    regSubmitBtn.disabled = true;

    try {
        localStorage.setItem('baseline_active_view', 'mainDashboard');
        const cred = await createUserWithEmailAndPassword(auth, emailVal, passVal);
        await createBaselineProfile(cred.user, "email_password");
        regSubmitBtn.textContent = "Baseline Established!";
        regSubmitBtn.style.backgroundColor = "#A3CC00"; 
    } catch (error) {
        showGlobalError(regGlobalError, error.code === 'auth/email-already-in-use' ? "Email already registered. Please Sign In." : "Calibration failed. Try again.");
        resetSubmitButton(regSubmitBtn, originalText);
    }
});

const regGoogleBtn = document.getElementById('reg-googleBtn');
regGoogleBtn?.addEventListener('click', async () => {
    if (regGlobalError) regGlobalError.style.display = "none";
    const originalText = regGoogleBtn.innerHTML;
    regGoogleBtn.innerHTML = "Opening Secure Gateway...";
    regGoogleBtn.disabled = true;

    try {
        localStorage.setItem('baseline_active_view', 'mainDashboard');
        
        if (isMobileDevice()) {
            // Mobile Flow: Redirect away from the page
            await signInWithRedirect(auth, googleProvider);
        } else {
            // Desktop Flow: Open popup, wait for result, and process immediately
            const result = await signInWithPopup(auth, googleProvider);
            await createBaselineProfile(result.user, "google_sso");
            regGoogleBtn.innerHTML = "Baseline Established!";
            regGoogleBtn.style.backgroundColor = "#A3CC00"; 
        }
    } catch (error) {
        showGlobalError(regGlobalError, error.code === 'auth/popup-closed-by-user' ? "Cancelled." : "Google Sign-In failed.");
        regGoogleBtn.innerHTML = originalText;
        regGoogleBtn.disabled = false;
    }
});

// Login Elements
const loginEmailInput = document.getElementById('login-emailInput');
const loginEmailCheckmark = document.getElementById('login-emailCheckmark');
const loginPasswordInput = document.getElementById('login-passwordInput');
const loginToggleBtn = document.getElementById('login-togglePasswordBtn');
const loginForm = document.getElementById('login-Form');
const loginSubmitBtn = document.getElementById('login-submitBtn');
const loginGlobalError = document.getElementById('login-globalError');
const loginGoogleBtn = document.getElementById('login-googleBtn');

loginEmailInput?.addEventListener('input', (e) => {
    if (emailRegex.test(e.target.value)) loginEmailCheckmark?.classList.add('active');
    else loginEmailCheckmark?.classList.remove('active');
});

loginToggleBtn?.addEventListener('click', () => toggleVisibility(loginPasswordInput, loginToggleBtn));

loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (loginGlobalError) loginGlobalError.style.display = "none";

    const emailVal = loginEmailInput.value;
    const passVal = loginPasswordInput.value;

    if (!emailRegex.test(emailVal)) {
        showGlobalError(loginGlobalError, "Please enter a valid email address.");
        return;
    }

    const originalText = loginSubmitBtn.textContent;
    loginSubmitBtn.textContent = "Authenticating...";
    loginSubmitBtn.disabled = true;

    try {
        localStorage.setItem('baseline_active_view', 'mainDashboard');
        await signInWithEmailAndPassword(auth, emailVal, passVal);
        loginSubmitBtn.textContent = "Access Granted";
        loginSubmitBtn.style.backgroundColor = "#A3CC00"; 
    } catch (error) {
        showGlobalError(loginGlobalError, "Incorrect email or password combination.");
        resetSubmitButton(loginSubmitBtn, originalText);
    }
});

loginGoogleBtn?.addEventListener('click', async () => {
    if (loginGlobalError) loginGlobalError.style.display = "none";
    const originalText = loginGoogleBtn.innerHTML;
    loginGoogleBtn.innerHTML = "Opening Secure Gateway...";
    loginGoogleBtn.disabled = true;

    try {
        localStorage.setItem('baseline_active_view', 'mainDashboard');
        
        if (isMobileDevice()) {
            // Mobile Flow: Redirect away from the page
            await signInWithRedirect(auth, googleProvider);
        } else {
            // Desktop Flow: Open popup, wait for result, and process immediately
            const result = await signInWithPopup(auth, googleProvider);
            await createBaselineProfile(result.user, "google_sso");
            loginGoogleBtn.innerHTML = "Access Granted";
            loginGoogleBtn.style.backgroundColor = "#A3CC00"; 
        }
    } catch (error) {
        showGlobalError(loginGlobalError, error.code === 'auth/popup-closed-by-user' ? "Cancelled." : "Google Sign-In failed.");
        loginGoogleBtn.innerHTML = originalText;
        loginGoogleBtn.disabled = false;
    }
});

const logoutBtnShell = document.getElementById('logoutBtn');
logoutBtnShell?.addEventListener('click', async () => {
    try {
        logoutBtnShell.textContent = "Disconnecting...";
        logoutBtnShell.style.opacity = "0.7";

        if (globalUserId) {
            localStorage.removeItem(`baseline_cache_${globalUserId}`);
            localStorage.removeItem('baseline_retro_draft');
            localStorage.removeItem('baseline_active_view');
        }

        await signOut(auth);
        window.location.reload(); 
    } catch (error) {
        console.error("Logout error", error);
    }
});

// ==========================================
// NAVIGATION & SHELL UI
// ==========================================
const navItemsList = document.querySelectorAll('.nav-item[data-target]');
const viewsList = document.querySelectorAll('main.dashboard-content');
const headerTitleDOM = document.querySelector('.header-title');
const sidebarDOM = document.getElementById('sidebar');
const mobileMenuBtnDOM = document.getElementById('mobileMenuBtn');
const closeSidebarBtnDOM = document.getElementById('closeSidebarBtn');

navItemsList.forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        const targetId = item.getAttribute('data-target');
        localStorage.setItem('baseline_active_view', targetId);

        navItemsList.forEach(nav => nav.classList.remove('active'));
        item.classList.add('active');

        viewsList.forEach(view => {
            view.classList.add('d-none');
            view.classList.remove('fade-in');
        });
        
        const targetView = document.getElementById(targetId);
        if (targetView) {
            targetView.classList.remove('d-none');
            setTimeout(() => targetView.classList.add('fade-in'), 10);
        }

        if (headerTitleDOM) {
            if (targetId === 'mainDashboard') headerTitleDOM.textContent = "Dashboard";
            if (targetId === 'mainHabitsLog') headerTitleDOM.textContent = "Execution Log";
            if (targetId === 'mainSettings') headerTitleDOM.textContent = "Settings";
            if (targetId === 'mainAnalytics') {
                headerTitleDOM.textContent = "Analytics";
                renderAnalyticsUI(); 
            }
        }

        if (window.innerWidth <= 768 && sidebarDOM) {
            sidebarDOM.classList.remove('mobile-open');
            document.body.style.overflow = '';
        }
    });
});

mobileMenuBtnDOM?.addEventListener('click', () => {
    if (sidebarDOM) sidebarDOM.classList.add('mobile-open');
    document.body.style.overflow = 'hidden';
});

closeSidebarBtnDOM?.addEventListener('click', () => {
    if (sidebarDOM) sidebarDOM.classList.remove('mobile-open');
    document.body.style.overflow = '';
});

// ==========================================
// REAL-TIME PROTOCOL LISTENERS
// ==========================================
function initializeRealTimeHabits(user) {
    const userHabitsRef = collection(db, "Users", user.uid, "Habits");
    const q = query(userHabitsRef, orderBy("createdAt", "desc"));

    onSnapshot(q, (snapshot) => {
        activeHabitsMap = {}; 

        snapshot.forEach((docSnap) => {
            const habit = docSnap.data();
            const habitId = docSnap.id;
            habit.id = habitId;
            const currentStreak = habit.telemetry ? habit.telemetry.currentStreak : 0;
            
            if (currentStreak > 0 && isStreakBroken(habit.lastCompletedAt)) {
                const habitRef = doc(db, "Users", globalUserId, "Habits", habitId);
                updateDoc(habitRef, { "telemetry.currentStreak": 0 }).catch(err => console.error(err));
                
                const logRef = collection(db, "Users", globalUserId, "ExecutionLog");
                addDoc(logRef, {
                    habitId: habitId,
                    habitName: habit.name,
                    icon: habit.icon || "🎯",
                    type: "failure",
                    timestamp: serverTimestamp(),
                    note: "System Auto-Log: Protocol execution window missed."
                }).catch(err => console.error("Auto-log failed", err));

                habit.telemetry.currentStreak = 0; 
            }
            activeHabitsMap[habitId] = habit;
        });

        localStorage.setItem(`baseline_cache_${globalUserId}`, JSON.stringify(activeHabitsMap));
        renderDashboardUI();
    });
}

function renderDashboardUI() {
    const habitListContainerDOM = document.getElementById('habitList');
    const filterTimelineHabitDOM = document.getElementById('filterTimelineHabit');
    const dailyProgressBarDOM = document.getElementById('dailyProgressBar');
    const dailyProgressTextDOM = document.getElementById('dailyProgressText');

    if (!habitListContainerDOM) return;

    if (filterTimelineHabitDOM) {
        filterTimelineHabitDOM.innerHTML = '<option value="all">All Protocols</option>';
        Object.entries(activeHabitsMap).forEach(([id, habit]) => {
            const filterOption = document.createElement('option');
            filterOption.value = id;
            filterOption.textContent = `${habit.icon || "🎯"} ${habit.name}`;
            filterTimelineHabitDOM.appendChild(filterOption);
        });
    }

    const habitsArray = Object.entries(activeHabitsMap);

    let totalHabits = 0;
    let completedTodayCount = 0;
    let pendingHabits = 0;
    let apexStreak = 0;
    let totalDeepWorkMins = 0;
    const todayStr = getLocalDateString();

    habitsArray.forEach(([habitId, habit]) => {
        totalHabits++;
        const currentStreak = habit.telemetry ? habit.telemetry.currentStreak : 0;
        const completedDates = habit.completedDates || [];
        const isDoneToday = completedDates.includes(todayStr); 
        const isPending = isHabitPendingToday(habit);
        
        if (isDoneToday) completedTodayCount++;
        if (isPending) pendingHabits++;
        
        if (currentStreak > apexStreak) apexStreak = currentStreak;
        if (habit.telemetry?.focusHistory?.[todayStr]) {
            totalDeepWorkMins += habit.telemetry.focusHistory[todayStr];
        }
    });

    const actionableTodayCount = completedTodayCount + pendingHabits;

    if (habitsArray.length === 0) {
        habitListContainerDOM.innerHTML = `
            <div class="col-12 text-center py-5" id="emptyStateMessage">
                <p class="text-muted mb-0" style="font-size: 16px;">No active protocols established yet.</p>
                <p class="text-muted mt-2" style="font-size: 14px;">Click "+ Add Habit" to begin tracking.</p>
            </div>
        `;
        
        if (dailyProgressTextDOM) dailyProgressTextDOM.textContent = "0 of 0 Protocols Executed";
        if (dailyProgressBarDOM) gsap.to(dailyProgressBarDOM, { width: "0%", duration: 0.5 });
        
        const updateElements = [
            { id: 'hudApexStreak', text: "0" },
            { id: 'hudFocusTime', text: "0" },
            { id: 'hudStatusText', text: "Awaiting protocol creation." }
        ];
        
        updateElements.forEach(el => {
            const domEl = document.getElementById(el.id);
            if (domEl) domEl.textContent = el.text;
        });

        const statusInd = document.getElementById('hudStatusIndicator');
        if (statusInd) {
            statusInd.style.backgroundColor = "var(--text-muted)";
            statusInd.style.boxShadow = "none";
        }
        return; 
    } else {
        document.getElementById('emptyStateMessage')?.remove();
    }

    const activeHabitIds = habitsArray.map(([id]) => id);
    const existingCardWrappers = habitListContainerDOM.querySelectorAll('.habit-card-wrapper');
    existingCardWrappers.forEach(wrapper => {
        const cardId = wrapper.querySelector('.habit-card').getAttribute('data-id');
        if (!activeHabitIds.includes(cardId)) wrapper.remove(); 
    });

    habitsArray.forEach(([habitId, habit]) => {
        const currentStreak = habit.telemetry ? habit.telemetry.currentStreak : 0;
        const completedDates = habit.completedDates || [];
        const completedToday = completedDates.includes(todayStr);

        let subtitleText = "Daily Protocol";
        if (habit.frequency?.type === "every_x_days") subtitleText = `Every ${habit.frequency.target} days`;
        if (habit.frequency?.type === "times_per_week") subtitleText = `${habit.frequency.target}x per week`;
        if (habit.frequency?.type === "times_per_month") subtitleText = `${habit.frequency.target}x per month`;

        let streakHTML = '';
        if (currentStreak > 0) {
            const streakStateClass = completedToday ? 'streak-safe' : 'streak-danger';
            streakHTML = `<div class="streak-badge ${streakStateClass}">🔥 ${currentStreak}</div>`;
        }

        const existingCard = habitListContainerDOM.querySelector(`.habit-card[data-id="${habitId}"]`);

        if (existingCard) {
            existingCard.querySelector('.habit-title').textContent = habit.name;
            existingCard.querySelector('.habit-subtitle').textContent = subtitleText;
            existingCard.querySelector('.habit-icon').textContent = habit.icon || "🎯";
            let badgeDOM = existingCard.querySelector('.streak-badge');
            if (currentStreak > 0) {
                const streakStateClass = completedToday ? 'streak-safe' : 'streak-danger';
                if (badgeDOM) {
                    badgeDOM.textContent = `🔥 ${currentStreak}`;
                    badgeDOM.className = `streak-badge ${streakStateClass}`;
                } else {
                    existingCard.insertAdjacentHTML('afterbegin', `<div class="streak-badge ${streakStateClass}">🔥 ${currentStreak}</div>`);
                }
            } else if (badgeDOM) {
                badgeDOM.remove();
            }
        } else {
            const cardHTML = `
                <div class="col-6 col-md-4 col-xl-3 fade-in habit-card-wrapper">
                    <div class="bento-card habit-card" data-id="${habitId}">
                        ${streakHTML}
                        <div class="habit-icon">${habit.icon || "🎯"}</div>
                        <div class="habit-title">${habit.name}</div>
                        <div class="habit-subtitle">${subtitleText}</div>
                    </div>
                </div>
            `;
            habitListContainerDOM.insertAdjacentHTML('beforeend', cardHTML);
        }
    });

    const elApex = document.getElementById('hudApexStreak');
    if (elApex) elApex.textContent = apexStreak;
    
    const elFocus = document.getElementById('hudFocusTime');
    if (elFocus) elFocus.textContent = totalDeepWorkMins;

    const statusText = document.getElementById('hudStatusText');
    const statusIndicator = document.getElementById('hudStatusIndicator');

    if (statusText && statusIndicator) {
        if (pendingHabits === 0) {
            statusText.innerHTML = `<strong>Optimal:</strong> All scheduled protocols have been executed.`;
            statusIndicator.style.backgroundColor = "var(--cyber-yellow)";
            statusIndicator.style.boxShadow = "0 0 10px rgba(212, 255, 0, 0.6)";
        } else {
            statusText.innerHTML = `<strong>Action Required:</strong> ${pendingHabits} protocols pending execution.`;
            statusIndicator.style.backgroundColor = "var(--diagnostic-amber)";
            statusIndicator.style.boxShadow = "0 0 10px rgba(255, 176, 32, 0.6)";
        }
    }

    if (actionableTodayCount > 0 && dailyProgressTextDOM && dailyProgressBarDOM) {
        dailyProgressTextDOM.textContent = `${completedTodayCount} of ${actionableTodayCount} Protocols Executed`;
        const percentage = (completedTodayCount / actionableTodayCount) * 100;
        gsap.set(dailyProgressBarDOM, { backgroundColor: "var(--cyber-yellow)", boxShadow: "0 0 12px rgba(212, 255, 0, 0.5)" });
        gsap.to(dailyProgressBarDOM, { width: `${percentage}%`, duration: 0.8, ease: "power2.out" });
    } else if (actionableTodayCount === 0 && dailyProgressTextDOM && dailyProgressBarDOM) {
        dailyProgressTextDOM.textContent = `Standby: No protocols required today.`;
        gsap.to(dailyProgressBarDOM, { width: `100%`, duration: 0.8, ease: "power2.out", backgroundColor: "var(--text-muted)", boxShadow: "none" });
    }
    
    generateSystemAlerts();
    
    const analyticsView = document.getElementById('mainAnalytics');
    if (analyticsView && !analyticsView.classList.contains('d-none')) {
        renderAnalyticsUI();
    }
}

// ==========================================
// NOTIFICATIONS & ALERTS
// ==========================================
const notificationBtnDOM = document.getElementById('notificationBtn');
const notificationPopoverDOM = document.getElementById('notificationPopover');
const notificationBadgeDOM = document.getElementById('notificationBadge');
const notificationListDOM = document.getElementById('notificationList');
const markReadBtnDOM = document.getElementById('markReadBtn');

function renderNotifications() {
    if (!notificationListDOM) return;
    notificationListDOM.innerHTML = '';
    let unreadCount = 0;

    if (systemAlerts.length === 0) {
        notificationListDOM.innerHTML = `
            <div class="text-center py-4 text-muted" style="font-size: 13px;">
                No system alerts at this time.
            </div>
        `;
        notificationBadgeDOM?.classList.add('d-none');
        return;
    }

    systemAlerts.forEach(alert => {
        if (alert.unread) unreadCount++;
        const itemHTML = `
            <div class="notification-item ${alert.unread ? 'unread' : ''}" data-id="${alert.id}">
                <div class="noti-icon">${alert.icon}</div>
                <div class="noti-content">
                    <div class="noti-title">${alert.title}</div>
                    <div class="noti-desc">${alert.desc}</div>
                    <div class="noti-time">${alert.time}</div>
                </div>
            </div>
        `;
        notificationListDOM.insertAdjacentHTML('beforeend', itemHTML);
    });

    if (notificationBadgeDOM) {
        if (unreadCount > 0) notificationBadgeDOM.classList.remove('d-none');
        else notificationBadgeDOM.classList.add('d-none');
    }
}

function generateSystemAlerts() {
    systemAlerts = []; 
    const dismissedAlerts = JSON.parse(localStorage.getItem('baseline_dismissed_alerts') || '[]');
    const todayStr = getLocalDateString();
    const now = new Date();

    Object.values(activeHabitsMap).forEach(habit => {
        const currentStreak = habit.telemetry ? habit.telemetry.currentStreak : 0;
        const completedToday = isCompletedToday(habit.lastCompletedAt);
        const alertId = `risk_${habit.id}_${todayStr}`; 

        if (currentStreak > 0 && !completedToday && !dismissedAlerts.includes(alertId)) {
            systemAlerts.push({
                id: alertId, 
                icon: "⚠️",
                title: "Protocol at Risk",
                desc: `Your ${currentStreak}-day execution streak for '${habit.name}' will break if not completed by midnight.`,
                time: "System Warning",
                unread: true
            });
        }
    });

    const notifyMorningDOM = document.getElementById('notifyMorningToggle');
    const wantsMorning = notifyMorningDOM ? notifyMorningDOM.checked : true;
    const currentHour = now.getHours();
    const morningAlertId = `morning_brief_${todayStr}`;

    if (wantsMorning && currentHour >= 5 && currentHour < 12 && !dismissedAlerts.includes(morningAlertId)) {
        let pendingCount = 0;
        Object.values(activeHabitsMap).forEach(h => {
            if (h.status === 'active' && isHabitPendingToday(h) && !isCompletedToday(h.lastCompletedAt)) {
                pendingCount++;
            }
        });

        if (pendingCount > 0) {
            systemAlerts.push({
                id: morningAlertId,
                icon: "🌅",
                title: "Morning Briefing",
                desc: `Good morning. You have ${pendingCount} protocols queued for execution today. Let's get to work.`,
                time: "08:00 AM",
                unread: true
            });
        }
    }

    const notifyWeeklyDOM = document.getElementById('notifyWeeklyToggle');
    const wantsWeekly = notifyWeeklyDOM ? notifyWeeklyDOM.checked : true;
    const isSunday = now.getDay() === 0;
    const weeklyAlertId = `weekly_report_${todayStr}`;

    if (wantsWeekly && isSunday && !dismissedAlerts.includes(weeklyAlertId)) {
        systemAlerts.push({
            id: weeklyAlertId,
            icon: "📊",
            title: "Weekly Diagnostic Ready",
            desc: "Your 7-day performance metrics and behavioral correlations have been compiled. Head to the Analytics tab to review.",
            time: "System Update",
            unread: true
        });
    }

    renderNotifications();
}

notificationBtnDOM?.addEventListener('click', (e) => {
    e.stopPropagation(); 
    notificationPopoverDOM?.classList.toggle('d-none');
    if (!notificationPopoverDOM?.classList.contains('d-none')) renderNotifications();
    
    document.getElementById('frequencyPopover')?.classList.add('d-none');
    document.getElementById('reminderPopover')?.classList.add('d-none');
    document.getElementById('iconGridPopover')?.classList.add('d-none');
});

markReadBtnDOM?.addEventListener('click', (e) => {
    e.stopPropagation();
    let dismissedAlerts = JSON.parse(localStorage.getItem('baseline_dismissed_alerts') || '[]');
    systemAlerts.forEach(alert => {
        alert.unread = false;
        if (!dismissedAlerts.includes(alert.id)) dismissedAlerts.push(alert.id);
    });
    if (dismissedAlerts.length > 50) dismissedAlerts = dismissedAlerts.slice(-50);
    localStorage.setItem('baseline_dismissed_alerts', JSON.stringify(dismissedAlerts));
    
    systemAlerts = [];
    renderNotifications();
    
    markReadBtnDOM.textContent = "Cleared";
    setTimeout(() => markReadBtnDOM.textContent = "Mark all read", 2000);
});

// ==========================================
// PROTOCOL CREATION & MANAGEMENT MODALS
// ==========================================
const addHabitBtnDOM = document.getElementById('addHabitBtn');
const modalOverlayDOM = document.getElementById('habitModalOverlay');
const habitModalCardDOM = document.getElementById('habitModalCard');
const closeModalBtnDOM = document.getElementById('closeModalBtn');
const newHabitFormDOM = document.getElementById('newHabitForm');
const saveHabitBtnDOM = document.getElementById('saveHabitBtn');

const habitIconBtnDOM = document.getElementById('habitIconBtn');
const habitIconInputDOM = document.getElementById('habitIconInput');
const iconGridPopoverDOM = document.getElementById('iconGridPopover');

const frequencyDisplayBtnDOM = document.getElementById('frequencyDisplayBtn');
const frequencyPopoverDOM = document.getElementById('frequencyPopover');
const frequencyDisplayTextDOM = document.getElementById('frequencyDisplayText');
const frequencyRadiosDOM = document.getElementsByName('frequencyRadio');
const freqNumberInputsDOM = document.querySelectorAll('.freq-num-input');

const reminderClockBtnDOM = document.getElementById('reminderClockBtn');
const reminderDisplayDOM = document.getElementById('reminderDisplay');
const reminderPopoverDOM = document.getElementById('reminderPopover');
const saveReminderBtnDOM = document.getElementById('saveReminderBtn');
const clearReminderBtnDOM = document.getElementById('clearReminderBtn');
const clockHourDOM = document.getElementById('clockHour');
const clockMinuteDOM = document.getElementById('clockMinute');
const clockAmPmDOM = document.getElementById('clockAmPm');

addHabitBtnDOM?.addEventListener('click', () => {
    modalOverlayDOM?.classList.remove('d-none');
    if(habitModalCardDOM) gsap.set(habitModalCardDOM, { x: 50, y: 0, opacity: 0 });
    const tl = gsap.timeline();
    if(modalOverlayDOM) tl.to(modalOverlayDOM, { opacity: 1, duration: 0.2, ease: "power2.out" });
    if(habitModalCardDOM) tl.to(habitModalCardDOM, { x: 0, opacity: 1, duration: 0.3, ease: "power3.out" }, "-=0.1");
    document.getElementById('habitNameInput')?.focus();
});

function updateFrequencyDisplay() {
    const selectedRadio = document.querySelector('input[name="frequencyRadio"]:checked');
    if (!selectedRadio) return;
    const val = selectedRadio.value;
    let text = "Every day";
    
    if (val === 'every_x_days') {
        const num = document.getElementById('freqEveryXDaysInput');
        if(num) text = `Every ${num.value} days`;
    } else if (val === 'times_per_week') {
        const num = document.getElementById('freqTimesPerWeekInput');
        if(num) text = `${num.value} times per week`;
    } else if (val === 'times_per_month') {
        const num = document.getElementById('freqTimesPerMonthInput');
        if(num) text = `${num.value} times per month`;
    }
    if (frequencyDisplayTextDOM) frequencyDisplayTextDOM.textContent = text;
}

function closeModal() {
    const tl = gsap.timeline({
        onComplete: () => {
            modalOverlayDOM?.classList.add('d-none');
            newHabitFormDOM?.reset(); 
            if (habitIconInputDOM) habitIconInputDOM.value = "🎯";
            if (habitIconBtnDOM) habitIconBtnDOM.textContent = "🎯";
            if (frequencyDisplayTextDOM) frequencyDisplayTextDOM.textContent = "Every day";
            if (reminderDisplayDOM) reminderDisplayDOM.value = "Off";
            freqNumberInputsDOM.forEach(input => input.disabled = true);
            frequencyPopoverDOM?.classList.add('d-none');
            reminderPopoverDOM?.classList.add('d-none');
        }
    });
    iconGridPopoverDOM?.classList.add('d-none');
    habitIconBtnDOM?.classList.remove('active');
    
    if (habitModalCardDOM) tl.to(habitModalCardDOM, { x: 50, opacity: 0, duration: 0.2, ease: "power2.in" });
    if (modalOverlayDOM) tl.to(modalOverlayDOM, { opacity: 0, duration: 0.2, ease: "power2.in" }, "-=0.1");
}

closeModalBtnDOM?.addEventListener('click', closeModal);
modalOverlayDOM?.addEventListener('click', (e) => { if (e.target === modalOverlayDOM) closeModal(); });

if (habitIcons && iconGridPopoverDOM) {
    habitIcons.forEach(icon => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'icon-option';
        btn.textContent = icon;
        btn.addEventListener('click', () => {
            if (habitIconInputDOM) habitIconInputDOM.value = icon;
            if (habitIconBtnDOM) habitIconBtnDOM.textContent = icon;
            iconGridPopoverDOM.classList.add('d-none');
            habitIconBtnDOM?.classList.remove('active');
        });
        iconGridPopoverDOM.appendChild(btn);
    });
}

habitIconBtnDOM?.addEventListener('click', (e) => {
    e.stopPropagation();
    iconGridPopoverDOM?.classList.toggle('d-none');
    habitIconBtnDOM.classList.toggle('active');
    frequencyPopoverDOM?.classList.add('d-none');
    reminderPopoverDOM?.classList.add('d-none');
});

frequencyDisplayBtnDOM?.addEventListener('click', (e) => {
    e.stopPropagation();
    frequencyPopoverDOM?.classList.toggle('d-none');
    reminderPopoverDOM?.classList.add('d-none');
    iconGridPopoverDOM?.classList.add('d-none');
});

frequencyRadiosDOM.forEach(radio => {
    radio.addEventListener('change', (e) => {
        freqNumberInputsDOM.forEach(input => input.disabled = true);
        const selectedValue = e.target.value;
        let inputToEnable = null;

        if (selectedValue === 'every_x_days') inputToEnable = document.getElementById('freqEveryXDaysInput');
        else if (selectedValue === 'times_per_week') inputToEnable = document.getElementById('freqTimesPerWeekInput');
        else if (selectedValue === 'times_per_month') inputToEnable = document.getElementById('freqTimesPerMonthInput');

        if (inputToEnable) {
            inputToEnable.disabled = false;
            inputToEnable.focus();
            inputToEnable.select();
        }
        updateFrequencyDisplay();
    });
});

freqNumberInputsDOM.forEach(input => {
    input.addEventListener('input', updateFrequencyDisplay);
    const parentLabel = input.closest('label');
    parentLabel?.addEventListener('click', () => {
        const radio = parentLabel.querySelector('input[type="radio"]');
        if (radio && !radio.checked) {
            radio.checked = true;
            radio.dispatchEvent(new Event('change')); 
        }
    });
});

reminderClockBtnDOM?.addEventListener('click', (e) => {
    e.stopPropagation();
    reminderPopoverDOM?.classList.toggle('d-none');
    frequencyPopoverDOM?.classList.add('d-none');
    iconGridPopoverDOM?.classList.add('d-none');
});

reminderDisplayDOM?.addEventListener('click', (e) => {
    e.stopPropagation();
    reminderPopoverDOM?.classList.toggle('d-none');
    frequencyPopoverDOM?.classList.add('d-none');
    iconGridPopoverDOM?.classList.add('d-none');
});

clockHourDOM?.addEventListener('blur', () => {
    let val = parseInt(clockHourDOM.value);
    if (isNaN(val) || val < 1) val = 1;
    if (val > 12) val = 12;
    clockHourDOM.value = val.toString().padStart(2, '0');
});

clockMinuteDOM?.addEventListener('blur', () => {
    let val = parseInt(clockMinuteDOM.value);
    if (isNaN(val) || val < 0) val = 0;
    if (val > 59) val = 59;
    clockMinuteDOM.value = val.toString().padStart(2, '0');
});

saveReminderBtnDOM?.addEventListener('click', () => {
    if (!clockHourDOM || !clockMinuteDOM) return;
    const { h, m } = formatTimeDisplay(clockHourDOM.value, clockMinuteDOM.value);
    const ampmVal = clockAmPmDOM ? clockAmPmDOM.value : 'AM';
    if (reminderDisplayDOM) reminderDisplayDOM.value = `${h}:${m} ${ampmVal}`;
    reminderPopoverDOM?.classList.add('d-none');
});

clearReminderBtnDOM?.addEventListener('click', () => {
    if (reminderDisplayDOM) reminderDisplayDOM.value = "Off";
    reminderPopoverDOM?.classList.add('d-none');
});

// Global Click handler for closing popovers
document.addEventListener('click', (e) => {
    if (iconGridPopoverDOM && habitIconBtnDOM && !iconGridPopoverDOM.contains(e.target) && e.target !== habitIconBtnDOM) {
        iconGridPopoverDOM.classList.add('d-none');
        habitIconBtnDOM.classList.remove('active');
    }
    if (frequencyPopoverDOM && frequencyDisplayBtnDOM && !frequencyPopoverDOM.contains(e.target) && e.target !== frequencyDisplayBtnDOM) {
        frequencyPopoverDOM.classList.add('d-none');
    }
    if (reminderPopoverDOM && reminderClockBtnDOM && reminderDisplayDOM && !reminderPopoverDOM.contains(e.target) && e.target !== reminderClockBtnDOM && e.target !== reminderDisplayDOM) {
        reminderPopoverDOM.classList.add('d-none');
    }
    if (window.innerWidth <= 768 && sidebarDOM && mobileMenuBtnDOM && !sidebarDOM.contains(e.target) && !mobileMenuBtnDOM.contains(e.target)) {
        sidebarDOM.classList.remove('mobile-open');
        document.body.style.overflow = '';
    }
    const nPopover = document.getElementById('notificationPopover');
    const nBtn = document.getElementById('notificationBtn');
    if (nPopover && nBtn && !nPopover.contains(e.target) && e.target !== nBtn) {
        nPopover.classList.add('d-none');
    }
});

newHabitFormDOM?.addEventListener('submit', async (e) => {
    e.preventDefault(); 
    if (!auth.currentUser) return;

    const originalBtnText = saveHabitBtnDOM.textContent;
    saveHabitBtnDOM.textContent = "SAVING...";
    saveHabitBtnDOM.disabled = true;
    saveHabitBtnDOM.style.opacity = "0.7";

    try {
        const selectedRadio = document.querySelector('input[name="frequencyRadio"]:checked');
        const freqType = selectedRadio ? selectedRadio.value : 'every_day';
        let freqValue = 1;

        if (freqType === 'every_x_days') freqValue = parseInt(document.getElementById('freqEveryXDaysInput')?.value || 1);
        else if (freqType === 'times_per_week') freqValue = parseInt(document.getElementById('freqTimesPerWeekInput')?.value || 1);
        else if (freqType === 'times_per_month') freqValue = parseInt(document.getElementById('freqTimesPerMonthInput')?.value || 1);

        const habitPayload = {
            name: document.getElementById('habitNameInput').value,
            icon: document.getElementById('habitIconInput').value,
            question: document.getElementById('habitQuestionInput').value,
            frequency: { type: freqType, target: freqValue },
            reminder: document.getElementById('reminderDisplay').value,
            notes: document.getElementById('habitNotesInput').value,
            createdAt: serverTimestamp(),
            status: "active",
            telemetry: { currentStreak: 0, totalCompletions: 0 },
            completedDates: [] 
        };

        const userHabitsRef = collection(db, "Users", auth.currentUser.uid, "Habits");
        await addDoc(userHabitsRef, habitPayload);
        closeModal();

    } catch (error) {
        alert("Network error. Could not establish protocol.");
    } finally {
        saveHabitBtnDOM.textContent = originalBtnText;
        saveHabitBtnDOM.disabled = false;
        saveHabitBtnDOM.style.opacity = "1";
    }
});

// ==========================================
// PROTOCOL DETAILS & ACTIONS ENGINE
// ==========================================
const habitDetailOverlayDOM = document.getElementById('habitDetailOverlay');
const habitDetailCardDOM = document.getElementById('habitDetailCard');
const closeDetailBtnDOM = document.getElementById('closeDetailBtn');
const completeHabitBtnDOM = document.getElementById('completeHabitBtn');
const deleteHabitBtnDOM = document.getElementById('deleteHabitBtn');
const successNoteInputDOM = document.getElementById('successNoteInput');

function closeDetailModal() {
    if(habitDetailCardDOM) gsap.to(habitDetailCardDOM, { y: 30, opacity: 0, scale: 0.95, duration: 0.2, ease: "power2.in" });
    if(habitDetailOverlayDOM) gsap.to(habitDetailOverlayDOM, { opacity: 0, duration: 0.2, ease: "power2.in", onComplete: () => {
        habitDetailOverlayDOM.classList.add('d-none');
        currentOpenHabitId = null;
        if (successNoteInputDOM) successNoteInputDOM.value = "";
    }});
}

closeDetailBtnDOM?.addEventListener('click', closeDetailModal);
habitDetailOverlayDOM?.addEventListener('click', (e) => { if (e.target === habitDetailOverlayDOM) closeDetailModal(); });

// Universal Escape Key Handler
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (modalOverlayDOM && !modalOverlayDOM.classList.contains('d-none')) closeModal();
        if (habitDetailOverlayDOM && !habitDetailOverlayDOM.classList.contains('d-none')) closeDetailModal();
        
        document.getElementById('closeRetroBtn')?.click();
        document.getElementById('closeFocusSetupBtn')?.click();
        
        if (typeof closeAnalyticsModalEngine === "function") closeAnalyticsModalEngine();
        if (typeof closeSummaryModal === "function") closeSummaryModal();
    }
});

document.getElementById('habitList')?.addEventListener('click', (e) => {
    const card = e.target.closest('.habit-card');
    if (!card) return;

    currentOpenHabitId = card.getAttribute('data-id');
    const habitData = activeHabitsMap[currentOpenHabitId];

    if (habitData) {
        const dIcon = document.getElementById('detailIcon');
        const dName = document.getElementById('detailName');
        const dQuest = document.getElementById('detailQuestion');
        const dStreak = document.getElementById('detailStreak');
        const dComp = document.getElementById('detailCompletions');
        const dFreq = document.getElementById('detailFrequency');
        const dRem = document.getElementById('detailReminder');

        if(dIcon) dIcon.textContent = habitData.icon || "🎯";
        if(dName) dName.textContent = habitData.name;
        if(dQuest) dQuest.textContent = habitData.question || "Did you execute the protocol today?";
        if(dStreak) dStreak.textContent = habitData.telemetry ? habitData.telemetry.currentStreak : 0;
        if(dComp) dComp.textContent = habitData.telemetry ? habitData.telemetry.totalCompletions : 0;
        
        if (dFreq && habitData.frequency) {
            let fText = "Every Day";
            if (habitData.frequency.type === "every_x_days") fText = `Every ${habitData.frequency.target} days`;
            if (habitData.frequency.type === "times_per_week") fText = `${habitData.frequency.target}x / week`;
            if (habitData.frequency.type === "times_per_month") fText = `${habitData.frequency.target}x / month`;
            dFreq.textContent = fText;
        }

        if (dRem) dRem.textContent = habitData.reminder || "Off";

        const weeklyRadarGrid = document.getElementById('weeklyRadarGrid');
        if (weeklyRadarGrid) {
            weeklyRadarGrid.innerHTML = '';
            const completedDates = habitData.completedDates || [];
            const daysOfWeek = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
            
            for (let i = 6; i >= 0; i--) {
                const dateToCheck = new Date();
                dateToCheck.setDate(dateToCheck.getDate() - i);
                const dateString = getLocalDateString(dateToCheck);
                const dayLabel = daysOfWeek[dateToCheck.getDay()];
                
                const isCompleted = completedDates.includes(dateString);
                const circleClass = isCompleted ? 'radar-circle completed' : 'radar-circle';
                const circleId = (i === 0) ? 'id="radarTodayCircle"' : '';

                const dayHTML = `
                    <div class="radar-day-column">
                        <span class="radar-day-label">${dayLabel}</span>
                        <div ${circleId} class="${circleClass}"></div>
                    </div>
                `;
                weeklyRadarGrid.insertAdjacentHTML('beforeend', dayHTML);
            }
        }

        if (habitDetailOverlayDOM) habitDetailOverlayDOM.classList.remove('d-none');
        if (habitDetailCardDOM) gsap.fromTo(habitDetailCardDOM, 
            { y: 50, opacity: 0, scale: 0.95 },
            { y: 0, opacity: 1, scale: 1, duration: 0.4, ease: "back.out(1.5)" }
        );
        if (habitDetailOverlayDOM) gsap.to(habitDetailOverlayDOM, { opacity: 1, duration: 0.2 });
    }
});

completeHabitBtnDOM?.addEventListener('click', async () => {
    if (!currentOpenHabitId || !auth.currentUser) return;
    
    const todayString = getLocalDateString();
    const habitData = activeHabitsMap[currentOpenHabitId];
    const completedDates = habitData.completedDates || [];

    if (completedDates.includes(todayString)) {
        alert("Protocol already executed today.");
        return;
    }

    const todayCircle = document.getElementById('radarTodayCircle');
    if (todayCircle) {
        todayCircle.classList.add('completed');
        gsap.fromTo(todayCircle, { scale: 0.5 }, { scale: 1, duration: 0.5, ease: "elastic.out(1, 0.3)" });
    }

    gsap.to(completeHabitBtnDOM, { scale: 0.95, duration: 0.1, yoyo: true, repeat: 1 });

    try {
        let trueStreak = habitData.telemetry ? habitData.telemetry.currentStreak : 0;
        if (isStreakBroken(habitData.lastCompletedAt)) {
            trueStreak = 0;
        }
        trueStreak += 1;

        const habitRef = doc(db, "Users", auth.currentUser.uid, "Habits", currentOpenHabitId);
        await updateDoc(habitRef, {
            "telemetry.totalCompletions": increment(1),
            "telemetry.currentStreak": trueStreak,
            "lastCompletedAt": serverTimestamp(),
            "completedDates": arrayUnion(todayString)
        });

        const logRef = collection(db, "Users", auth.currentUser.uid, "ExecutionLog");
        await addDoc(logRef, {
            habitId: currentOpenHabitId,
            habitName: habitData.name,
            icon: habitData.icon || "🎯",
            type: "success",
            timestamp: serverTimestamp(),
            note: successNoteInputDOM ? successNoteInputDOM.value.trim() : ""
        });

        if (habitDetailCardDOM) {
            gsap.to(habitDetailCardDOM, {
                boxShadow: "0 0 60px rgba(212, 255, 0, 0.4)",
                scale: 1.02,
                duration: 0.3,
                delay: 0.2,
                yoyo: true,
                repeat: 1,
                onComplete: () => {
                    gsap.set(habitDetailCardDOM, { clearProps: "boxShadow,scale" });
                    closeDetailModal();
                }
            });
        } else {
            closeDetailModal();
        }

    } catch (error) {
        console.error("Failed to sync completion:", error);
        alert("Network error. Could not sync completion.");
    }
});

deleteHabitBtnDOM?.addEventListener('click', async () => {
    if (!currentOpenHabitId || !auth.currentUser) return;
    const confirmDelete = confirm("Are you sure you want to delete this protocol? All telemetry will be lost.");
    if (!confirmDelete) return;

    const idToDelete = currentOpenHabitId; 

    try {
        delete activeHabitsMap[idToDelete];
        localStorage.setItem(`baseline_cache_${auth.currentUser.uid}`, JSON.stringify(activeHabitsMap));
        
        const focusOption = document.querySelector(`#focusHabitSelect option[value="${idToDelete}"]`);
        if (focusOption) focusOption.remove();

        renderDashboardUI(); 
        closeDetailModal();

        const habitRef = doc(db, "Users", auth.currentUser.uid, "Habits", idToDelete);
        await deleteDoc(habitRef);
        
    } catch (error) {
        console.error("Deletion failed: ", error);
        alert("Network error or Firebase Permission Denied. Could not fully delete protocol from server.");
    }
});

// ==========================================
// FOCUS & DEEP WORK ENGINE
// ==========================================
const initFocusBtnDOM = document.getElementById('initFocusCardBtn');
const focusSetupDOM = document.getElementById('focusSetupOverlay');
const closeFocusBtnDOM = document.getElementById('closeFocusSetupBtn');
const startFocusBtnDOM = document.getElementById('startFocusBtn');
const focusTotalTimeDOM = document.getElementById('focusTotalTime');
const focusRestCountDOM = document.getElementById('focusRestCount');
const focusMathPreviewDOM = document.getElementById('focusMathPreview');
const focusHabitSelectDOM = document.getElementById('focusHabitSelect');
const focusSandboxDOM = document.getElementById('focusSandbox');
const focusPhaseBadgeDOM = document.getElementById('focusPhaseBadge');
const focusActiveIconDOM = document.getElementById('focusActiveIcon');
const focusActiveNameDOM = document.getElementById('focusActiveName');
const focusTimerDisplayDOM = document.getElementById('focusTimerDisplay');
const abortFocusBtnDOM = document.getElementById('abortFocusBtn');
const pauseFocusBtnDOM = document.getElementById('pauseFocusBtn');
const skipFocusBtnDOM = document.getElementById('skipFocusBtn');

function getFocusSettings() { return cachedFocusSettings; }

function updateMathPreview() {
    const { rest } = getFocusSettings();
    const totalMins = focusTotalTimeDOM ? parseInt(focusTotalTimeDOM.value) || 0 : 0;
    const rests = focusRestCountDOM ? parseInt(focusRestCountDOM.value) || 0 : 0;
    const workBlocks = rests + 1;
    
    const totalRestTime = rests * rest;
    const totalWorkTime = totalMins - totalRestTime;

    if (totalWorkTime <= 0) {
        if (focusMathPreviewDOM) focusMathPreviewDOM.innerHTML = `<span class="text-danger">Error: Rest time exceeds total time.</span>`;
        return;
    }

    const blockDuration = Math.floor(totalWorkTime / workBlocks);
    if (focusMathPreviewDOM) focusMathPreviewDOM.innerHTML = `This splits into <strong>${workBlocks} focus sessions</strong> of <strong>~${blockDuration} minutes</strong> each.`;
}

focusTotalTimeDOM?.addEventListener('input', updateMathPreview);
focusRestCountDOM?.addEventListener('input', updateMathPreview);

initFocusBtnDOM?.addEventListener('click', () => {
    if (focusHabitSelectDOM) {
        focusHabitSelectDOM.innerHTML = '<option value="" disabled selected>Select an active protocol...</option>';
        Object.entries(activeHabitsMap).forEach(([id, habit]) => {
            const isAvailable = habit.status === "active" && !isCompletedToday(habit.lastCompletedAt);
            if (isAvailable) {
                const option = document.createElement('option');
                option.value = id;
                option.textContent = `${habit.icon || "🎯"} ${habit.name}`;
                focusHabitSelectDOM.appendChild(option);
            }
        });
    }

    const { work, rest } = getFocusSettings();
    const restLabel = document.getElementById('focusRestLabel');
    if (restLabel) restLabel.textContent = `Rest Periods (${rest}m each)`;

    if (focusTotalTimeDOM) focusTotalTimeDOM.value = work;
    if (focusRestCountDOM) focusRestCountDOM.value = 0;

    updateMathPreview();
    
    if (focusSetupDOM) {
        focusSetupDOM.classList.remove('d-none');
        gsap.to(focusSetupDOM, { opacity: 1, duration: 0.2 });
    }
});

document.getElementById('focusHistoryBtn')?.addEventListener('click', (e) => {
    e.stopPropagation(); 
    document.querySelector('.nav-item[data-target="mainHabitsLog"]')?.click();
});

document.getElementById('focusStatsBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelector('.nav-item[data-target="mainAnalytics"]')?.click();
});

closeFocusBtnDOM?.addEventListener('click', () => focusSetupDOM?.classList.add('d-none'));

startFocusBtnDOM?.addEventListener('click', () => {
    if (!focusHabitSelectDOM) return;
    activeFocusHabitId = focusHabitSelectDOM.value; // Solves the scope leak issue
    if (!activeFocusHabitId) {
        alert("Please select a protocol.");
        return;
    }

    const { rest } = getFocusSettings();
    const totalMins = focusTotalTimeDOM ? parseInt(focusTotalTimeDOM.value) : 0;
    const rests = focusRestCountDOM ? parseInt(focusRestCountDOM.value) : 0;
    const workBlocks = rests + 1;
    const totalRestTime = rests * rest;
    const totalWorkTime = totalMins - totalRestTime;

    if (totalWorkTime <= 0) {
        alert("Invalid configuration. Rest time equals or exceeds total time.");
        return;
    }

    const baseBlockDuration = Math.floor(totalWorkTime / workBlocks);
    const remainderMinutes = totalWorkTime % workBlocks; 
    
    focusPhases = [];
    for (let i = 0; i < workBlocks; i++) {
        const currentBlockDuration = (i === workBlocks - 1) 
            ? baseBlockDuration + remainderMinutes 
            : baseBlockDuration;

        focusPhases.push({ 
            type: 'work', 
            durationSecs: currentBlockDuration * 60, 
            blockNum: i + 1, 
            totalBlocks: workBlocks 
        });

        if (i < rests) focusPhases.push({ type: 'rest', durationSecs: rest * 60 });
    }

    const habitData = activeHabitsMap[activeFocusHabitId];
    if (focusActiveIconDOM) focusActiveIconDOM.textContent = habitData.icon || "🎯";
    if (focusActiveNameDOM) focusActiveNameDOM.textContent = habitData.name;
    
    focusSetupDOM?.classList.add('d-none');
    focusSandboxDOM?.classList.remove('d-none');
    
    totalMinutesLogged = 0;
    startPhase(0);
});

function startPhase(index) {
    if (index >= focusPhases.length) {
        endFocusSession(true);
        return;
    }

    currentPhaseIndex = index;
    const phase = focusPhases[currentPhaseIndex];
    timeRemaining = phase.durationSecs;
    isPaused = false;
    phaseMinutesLogged = 0; 
    expectedEndTime = Date.now() + (timeRemaining * 1000);

    if (focusPhaseBadgeDOM) {
        if (phase.type === 'work') {
            focusPhaseBadgeDOM.textContent = `Execution Phase ${phase.blockNum}/${phase.totalBlocks}`;
            focusPhaseBadgeDOM.className = 'focus-phase-badge';
        } else {
            focusPhaseBadgeDOM.textContent = `Rest Phase`;
            focusPhaseBadgeDOM.className = 'focus-phase-badge rest';
        }
    }

    if (pauseFocusBtnDOM) {
        pauseFocusBtnDOM.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`;
    }

    updateTimerDisplay();
    clearInterval(focusInterval);
    focusInterval = setInterval(tickTimer, 1000);
}

function tickTimer() {
    if (isPaused) {
        expectedEndTime += 1000;
        return;
    }
    
    const now = Date.now();
    timeRemaining = Math.max(0, Math.round((expectedEndTime - now) / 1000));
    updateTimerDisplay();

    if (focusPhases[currentPhaseIndex].type === 'work') {
        const secondsElapsed = focusPhases[currentPhaseIndex].durationSecs - timeRemaining;
        const trueMinutesElapsed = Math.floor(secondsElapsed / 60);
        
        if (trueMinutesElapsed > phaseMinutesLogged) {
            totalMinutesLogged += (trueMinutesElapsed - phaseMinutesLogged);
            phaseMinutesLogged = trueMinutesElapsed;
        }
    }

    if (timeRemaining <= 0) {
        clearInterval(focusInterval);
        startPhase(currentPhaseIndex + 1);
    }
}

function updateTimerDisplay() {
    const m = Math.floor(timeRemaining / 60).toString().padStart(2, '0');
    const s = (timeRemaining % 60).toString().padStart(2, '0');
    if (focusTimerDisplayDOM) focusTimerDisplayDOM.textContent = `${m}:${s}`;
}

pauseFocusBtnDOM?.addEventListener('click', () => {
    isPaused = !isPaused;
    pauseFocusBtnDOM.innerHTML = isPaused ? 
        `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>` : 
        `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`;
});

skipFocusBtnDOM?.addEventListener('click', () => {
    clearInterval(focusInterval);
    startPhase(currentPhaseIndex + 1);
});

abortFocusBtnDOM?.addEventListener('click', () => {
    if (confirm("Abort session? Logged work time will still be saved.")) {
        clearInterval(focusInterval);
        endFocusSession(false);
    }
});

async function endFocusSession(completedNaturally) {
    clearInterval(focusInterval);
    focusSandboxDOM?.classList.add('d-none');
    
    // Bug fix implemented here: using activeFocusHabitId
    if (totalMinutesLogged > 0 && auth.currentUser && activeFocusHabitId) {
        const habitData = activeHabitsMap[activeFocusHabitId];
        const todayStr = getLocalDateString();
        
        try {
            const habitRef = doc(db, "Users", auth.currentUser.uid, "Habits", activeFocusHabitId);
            await updateDoc(habitRef, {
                "telemetry.totalTimeFocused": increment(totalMinutesLogged),
                [`telemetry.focusHistory.${todayStr}`]: increment(totalMinutesLogged)
            });

            const logRef = collection(db, "Users", auth.currentUser.uid, "ExecutionLog");
            await addDoc(logRef, {
                habitId: activeFocusHabitId,
                habitName: habitData.name,
                icon: habitData.icon || "🎯",
                type: "focus", 
                duration: totalMinutesLogged, 
                timestamp: serverTimestamp(),
                note: `Logged ${totalMinutesLogged} mins of deep work.`
            });

        } catch (error) {
            console.error("Failed to log focus time:", error);
        }
    }

    if (completedNaturally) alert("Focus Session Complete! Telemetry updated.");
    activeFocusHabitId = null; // reset state
}

// ==========================================
// TIMELINE LOG & FAILURE RETRO ENGINE
// ==========================================
const executionTimelineDOM = document.getElementById('executionTimeline');
const logRetroBtnDOM = document.getElementById('logRetroBtn');
const retroModalOverlayDOM = document.getElementById('retroModalOverlay');
const retroModalCardDOM = document.getElementById('retroModalCard');
const closeRetroBtnDOM = document.getElementById('closeRetroBtn');
const saveRetroBtnDOM = document.getElementById('saveRetroBtn');
const retroHabitSelectDOM = document.getElementById('retroHabitSelect');
const retroNotesInputDOM = document.getElementById('retroNotesInput');
const filterTimelineTypeDOM = document.getElementById('filterTimelineType');
const loadMoreTimelineBtnDOM = document.getElementById('loadMoreTimelineBtn');

function attachTimelineListener() {
    if (!globalUserId) return;
    if (currentTimelineUnsub) currentTimelineUnsub();

    const logRef = collection(db, "Users", globalUserId, "ExecutionLog");
    const q = query(logRef, orderBy("timestamp", "desc"), limit(timelineLimit));

    currentTimelineUnsub = onSnapshot(q, (snapshot) => {
        if (!executionTimelineDOM) return;
        executionTimelineDOM.innerHTML = '';
        
        const typeFilter = filterTimelineTypeDOM ? filterTimelineTypeDOM.value : 'all';
        const habitFilter = document.getElementById('filterTimelineHabit') ? document.getElementById('filterTimelineHabit').value : 'all';
        let renderedCount = 0;

        if (snapshot.empty) {
            executionTimelineDOM.innerHTML = `
                <div class="text-center py-5 text-muted">
                    No timeline data available. Execute a protocol to begin logging.
                </div>
            `;
            loadMoreTimelineBtnDOM?.classList.add('d-none');
            return;
        }

        snapshot.forEach((docSnap) => {
            const log = docSnap.data();
            const logId = docSnap.id;

            if (typeFilter !== 'all' && log.type !== typeFilter) return;
            if (habitFilter !== 'all' && log.habitId !== habitFilter) return;

            renderedCount++;
            const timeStr = formatTimelineDate(log.timestamp);
            const isSuccess = log.type === "success";
            const nodeClass = isSuccess ? "node-success" : "node-failure";
            
            let retroLabel = "";
            let noteDisplay = "";
            let editButtonHTML = "";

            if (!isSuccess) {
                retroLabel = `<div class="timeline-retro-label">Failure Analysis</div>`;
                editButtonHTML = `
                    <button class="btn-icon edit-retro-btn position-absolute" style="top: 16px; right: 16px; background: rgba(255,255,255,0.05);" data-log-id="${logId}" data-habit-id="${log.habitId}" data-note="${log.note || ''}" title="Edit Analysis">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                `;
            } else if (log.note) {
                retroLabel = `<div class="timeline-retro-label" style="color: var(--cyber-yellow); background-color: rgba(212, 255, 0, 0.1);">Execution Note</div>`;
            }

            if (log.note) {
                const isAutoLog = log.note === "System Auto-Log: Protocol execution window missed.";
                const noteStyle = isAutoLog ? "font-style: italic; opacity: 0.6;" : "";
                noteDisplay = `<p class="timeline-note mt-2" style="${noteStyle}"><strong>Note:</strong> ${log.note}</p>`;
            }

            const logHTML = `
                <div class="timeline-node ${nodeClass} fade-in">
                    <div class="timeline-marker"></div>
                    <div class="timeline-card position-relative">
                        ${editButtonHTML}
                        <div class="timeline-header">
                            <div class="timeline-title">
                                <span>${log.icon}</span> ${log.habitName}
                            </div>
                            <div class="timeline-time" style="padding-right: 32px;">${timeStr}</div>
                        </div>
                        ${retroLabel}
                        ${noteDisplay}
                    </div>
                </div>
            `;
            executionTimelineDOM.insertAdjacentHTML('beforeend', logHTML);
        });

        if (renderedCount === 0) {
            executionTimelineDOM.innerHTML = `
                <div class="text-center py-5 text-muted">
                    No entries match the current filter criteria.
                </div>
            `;
        }

        if (loadMoreTimelineBtnDOM) {
            if (snapshot.docs.length === timelineLimit) loadMoreTimelineBtnDOM.classList.remove('d-none');
            else loadMoreTimelineBtnDOM.classList.add('d-none');
        }
    });
}

function initializeExecutionTimeline(user) {
    timelineLimit = 15; 
    attachTimelineListener();
}

filterTimelineTypeDOM?.addEventListener('change', attachTimelineListener);
document.getElementById('filterTimelineHabit')?.addEventListener('change', attachTimelineListener);

loadMoreTimelineBtnDOM?.addEventListener('click', () => {
    timelineLimit += 15; 
    attachTimelineListener();
});

retroNotesInputDOM?.addEventListener('input', (e) => {
    if (!currentlyEditingLogId) localStorage.setItem('baseline_retro_draft', e.target.value);
});

logRetroBtnDOM?.addEventListener('click', () => {
    currentlyEditingLogId = null; 
    const todayStr = getLocalDateString();
    let eligibleHabitsCount = 0;

    if (retroHabitSelectDOM) {
        retroHabitSelectDOM.innerHTML = '<option value="" disabled selected>Select the protocol...</option>';
        Object.entries(activeHabitsMap).forEach(([habitId, habit]) => {
            if ((habit.completedDates || []).includes(todayStr)) return;
            eligibleHabitsCount++;
            const option = document.createElement('option');
            option.value = habitId; 
            option.textContent = `${habit.icon || "🎯"} ${habit.name}`;
            option.dataset.name = habit.name; 
            option.dataset.icon = habit.icon || "🎯";
            retroHabitSelectDOM.appendChild(option);
        });
    }

    if (eligibleHabitsCount === 0) {
        alert("Optimal Performance: All actionable protocols have already been executed today. No failures to log!");
        return; 
    }

    const modalTitle = document.querySelector('#retroModalCard h3');
    if (modalTitle) modalTitle.textContent = "Log Failure Retro";
    if (retroHabitSelectDOM) retroHabitSelectDOM.disabled = false;
    if (retroNotesInputDOM) retroNotesInputDOM.value = localStorage.getItem('baseline_retro_draft') || "";
    openRetroModal();
});

executionTimelineDOM?.addEventListener('click', (e) => {
    const editBtn = e.target.closest('.edit-retro-btn');
    if (!editBtn) return;

    currentlyEditingLogId = editBtn.getAttribute('data-log-id');
    const habitId = editBtn.getAttribute('data-habit-id');
    const currentNote = editBtn.getAttribute('data-note');

    if (retroHabitSelectDOM) {
        retroHabitSelectDOM.innerHTML = '';
        const habit = activeHabitsMap[habitId];
        const option = document.createElement('option');
        option.value = habitId; 
        option.textContent = habit ? `${habit.icon || "🎯"} ${habit.name}` : `Deleted Protocol`;
        retroHabitSelectDOM.appendChild(option);
        retroHabitSelectDOM.disabled = true; 
    }

    const modalTitle = document.querySelector('#retroModalCard h3');
    if (modalTitle) modalTitle.textContent = "Edit Failure Analysis";

    if (retroNotesInputDOM) {
        const autoText = "System Auto-Log: Protocol execution window missed.";
        retroNotesInputDOM.value = currentNote === autoText ? "" : currentNote;
    }

    openRetroModal();
});

function openRetroModal() {
    if (retroModalOverlayDOM && retroModalCardDOM) {
        retroModalOverlayDOM.classList.remove('d-none');
        gsap.set(retroModalCardDOM, { y: 50, opacity: 0 });
        const tl = gsap.timeline();
        tl.to(retroModalOverlayDOM, { opacity: 1, duration: 0.2, ease: "power2.out" })
          .to(retroModalCardDOM, { y: 0, opacity: 1, duration: 0.3, ease: "power3.out" }, "-=0.1");
    }
}

function closeRetroModalEngine() {
    if (retroModalCardDOM) gsap.to(retroModalCardDOM, { y: 30, opacity: 0, duration: 0.2, ease: "power2.in" });
    if (retroModalOverlayDOM) {
        gsap.to(retroModalOverlayDOM, { opacity: 0, duration: 0.2, ease: "power2.in", onComplete: () => {
            retroModalOverlayDOM.classList.add('d-none');
            if (retroHabitSelectDOM) retroHabitSelectDOM.value = "";
            if (retroNotesInputDOM) retroNotesInputDOM.value = "";
            currentlyEditingLogId = null; 
            localStorage.removeItem('baseline_retro_draft');
        }});
    }
}

closeRetroBtnDOM?.addEventListener('click', closeRetroModalEngine);
retroModalOverlayDOM?.addEventListener('click', (e) => { if (e.target === retroModalOverlayDOM) closeRetroModalEngine(); });

saveRetroBtnDOM?.addEventListener('click', async () => {
    if (!retroHabitSelectDOM) return;
    const selectedOption = retroHabitSelectDOM.options[retroHabitSelectDOM.selectedIndex];
    if (!selectedOption) return;

    const habitId = selectedOption.value; 
    const retroNotes = retroNotesInputDOM ? retroNotesInputDOM.value.trim() : "";

    if (!habitId || !retroNotes) {
        alert("Please provide root cause analysis notes.");
        return;
    }

    const originalText = saveRetroBtnDOM.textContent;
    saveRetroBtnDOM.textContent = "SAVING...";
    saveRetroBtnDOM.disabled = true;

    try {
        if (currentlyEditingLogId) {
            const logDocRef = doc(db, "Users", auth.currentUser.uid, "ExecutionLog", currentlyEditingLogId);
            await updateDoc(logDocRef, { note: retroNotes });
        } else {
            const habitName = selectedOption.dataset.name;
            const habitIcon = selectedOption.dataset.icon;
            
            const logRef = collection(db, "Users", auth.currentUser.uid, "ExecutionLog");
            await addDoc(logRef, {
                habitId: habitId, 
                habitName: habitName,
                icon: habitIcon,
                type: "failure",
                timestamp: serverTimestamp(),
                note: retroNotes
            });

            const habitRef = doc(db, "Users", auth.currentUser.uid, "Habits", habitId);
            await updateDoc(habitRef, { "telemetry.currentStreak": 0 });
        }
        closeRetroModalEngine();
    } catch (error) {
        console.error("Failed to save retro:", error);
        alert("Network error.");
    } finally {
        saveRetroBtnDOM.textContent = originalText;
        saveRetroBtnDOM.disabled = false;
    }
});

// ==========================================
// ANALYTICS & DIAGNOSTICS ENGINE
// ==========================================
function renderAnalyticsUI() {
    const heatmapGridDOM = document.getElementById('heatmapGrid');
    const dayOfWeekChartDOM = document.getElementById('dayOfWeekChart');
    const monthlyTrendChartDOM = document.getElementById('monthlyTrendChart');
    const correlationTextDOM = document.getElementById('correlationText');

    if (!heatmapGridDOM || !dayOfWeekChartDOM || !monthlyTrendChartDOM) return;

    const heatmapData = {};
    Object.values(activeHabitsMap).forEach(habit => {
        (habit.completedDates || []).forEach(dateStr => {
            heatmapData[dateStr] = (heatmapData[dateStr] || 0) + 1;
        });
    });

    // Smart Baseline Score Calculation
    let possibleCompletions30d = 0;
    let actualCompletions30d = 0;
    
    for (let i = 0; i < 30; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = getLocalDateString(d);
        
        Object.values(activeHabitsMap).forEach(h => {
            if (h.status !== 'active') return;
            const createdAt = h.createdAt && typeof h.createdAt.toDate === 'function' ? h.createdAt.toDate() : new Date();
            if (createdAt <= new Date(dateStr + 'T23:59:59')) {
                possibleCompletions30d++;
                if ((h.completedDates || []).includes(dateStr)) actualCompletions30d++;
            }
        });
    }
    
    const score = possibleCompletions30d > 0 ? Math.round((actualCompletions30d / possibleCompletions30d) * 100) : 0;
    const scoreDisplayDOM = document.getElementById('analyticsScore');
    if (scoreDisplayDOM) scoreDisplayDOM.textContent = `${score}%`;

    // 365-Day Topography Map
    heatmapGridDOM.innerHTML = '';
    const currentYear = new Date().getFullYear();
    const isLeapYear = (currentYear % 4 === 0 && currentYear % 100 !== 0) || (currentYear % 400 === 0);
    const daysInYear = isLeapYear ? 366 : 365;
    const todayObj = new Date();
    todayObj.setHours(23, 59, 59, 999);

    for (let i = 1; i <= daysInYear; i++) {
        const d = new Date(currentYear, 0, i); 
        const dateStr = getLocalDateString(d);
        const count = heatmapData[dateStr] || 0;
        
        let eligibleHabits = 0;
        Object.values(activeHabitsMap).forEach(h => {
            const createdAt = h.createdAt && typeof h.createdAt.toDate === 'function' ? h.createdAt.toDate() : new Date();
            if (createdAt <= d) eligibleHabits++;
        });

        let percentage = 0;
        if (eligibleHabits > 0) percentage = Math.round((count / eligibleHabits) * 100);

        let level = 0;
        if (percentage > 0 && percentage <= 25) level = 1;
        else if (percentage > 25 && percentage <= 50) level = 2;
        else if (percentage > 50 && percentage <= 75) level = 3;
        else if (percentage > 75) level = 4;

        if (d > todayObj) {
            heatmapGridDOM.insertAdjacentHTML('beforeend', `<div class="heatmap-cell level-0" title="Day ${i}: Future Date"></div>`);
        } else {
            heatmapGridDOM.insertAdjacentHTML('beforeend', `<div class="heatmap-cell level-${level}" title="Day ${i} (${dateStr}): ${percentage}% Completed"></div>`);
        }
    }

    // Day of Week Radar
    const dayCounts = { 0:0, 1:0, 2:0, 3:0, 4:0, 5:0, 6:0 };
    let maxDayVolume = 0;
    for(let i = 0; i < 90; i++) {
        const d = new Date(); d.setDate(d.getDate() - i);
        dayCounts[d.getDay()] += (heatmapData[getLocalDateString(d)] || 0);
    }
    Object.values(dayCounts).forEach(v => { if(v > maxDayVolume) maxDayVolume = v; });

    dayOfWeekChartDOM.innerHTML = '';
    const startPref = localStorage.getItem('baseline_start_of_week') || 'monday';
    const dayIndexMap = { 'monday':0, 'tuesday':1, 'wednesday':2, 'thursday':3, 'friday':4, 'saturday':5, 'sunday':6 };
    const shiftAmount = dayIndexMap[startPref] || 0;
    
    const baseDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const baseIndices = [1, 2, 3, 4, 5, 6, 0]; 
    const days = [...baseDays.slice(shiftAmount), ...baseDays.slice(0, shiftAmount)];
    const indices = [...baseIndices.slice(shiftAmount), ...baseIndices.slice(0, shiftAmount)];

    days.forEach((day, i) => {
        const val = dayCounts[indices[i]];
        const percentage = maxDayVolume > 0 ? Math.round((val / maxDayVolume) * 100) : 0;
        const col = document.createElement('div');
        col.className = 'chart-column';
        col.innerHTML = `
            <div class="chart-bar-track" style="max-width: 48px; border-radius: 8px;" title="${val} total executions (90d)">
                <div class="chart-bar-fill" style="height: 0%; border-radius: 8px;"></div>
            </div>
            <span class="chart-label mt-2">${day}</span>
        `;
        dayOfWeekChartDOM.appendChild(col);
        setTimeout(() => { 
            const fill = col.querySelector('.chart-bar-fill');
            if (fill) fill.style.height = `${percentage}%`; 
        }, 100);
    });

    // 30-Day Trend Matrix
    const weekData = [0, 0, 0, 0]; 
    let maxWeekVolume = 0;
    for(let i = 0; i < 28; i++) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const count = heatmapData[getLocalDateString(d)] || 0;
        const wIndex = Math.floor(i / 7); 
        weekData[wIndex] += count;
    }
    weekData.forEach(v => { if(v > maxWeekVolume) maxWeekVolume = v; });

    const dynamicLabels = [];
    for (let w = 3; w >= 0; w--) {
        const endD = new Date(); endD.setDate(endD.getDate() - (w * 7));
        const startD = new Date(); startD.setDate(startD.getDate() - (w * 7) - 6);
        const startStr = startD.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const endStr = endD.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        dynamicLabels.push(`${startStr} - ${endStr}`);
    }

    monthlyTrendChartDOM.innerHTML = '';
    const reversedData = [weekData[3], weekData[2], weekData[1], weekData[0]];

    dynamicLabels.forEach((weekLabel, index) => {
        const val = reversedData[index];
        const percentage = maxWeekVolume > 0 ? Math.round((val / maxWeekVolume) * 100) : 0;
        const col = document.createElement('div');
        col.className = 'chart-column';
        col.innerHTML = `
            <div class="chart-bar-track" style="max-width: 72px; border-radius: 8px;" title="Volume: ${val}">
                <div class="chart-bar-fill" style="height: 0%; background-color: var(--text-muted); border-radius: 8px;"></div>
            </div>
            <span class="chart-label text-center mt-2" style="font-size: 11px; white-space: nowrap;">${weekLabel}</span>
        `;
        monthlyTrendChartDOM.appendChild(col);
        setTimeout(() => { 
            const fill = col.querySelector('.chart-bar-fill');
            if (fill) {
                fill.style.height = `${percentage}%`; 
                if (index === 3 && percentage > 0) fill.style.backgroundColor = "var(--cyber-yellow)";
            }
        }, 100);
    });

    // Correlation Diagnostics
    const habitsList = Object.values(activeHabitsMap);
    if (habitsList.length < 2) {
        if (correlationTextDOM) correlationTextDOM.innerHTML = `<strong>Insight:</strong> Insufficient telemetry data. Execute multiple protocols.`;
        return;
    }

    let anchorHabit = null; let maxComps = 0;
    habitsList.forEach(h => {
        const comps = (h.completedDates || []).length;
        if(comps > maxComps) { maxComps = comps; anchorHabit = h; }
    });

    if (maxComps === 0) return;

    let correlatedHabit = null; let maxOverlap = 0;
    const anchorDates = new Set(anchorHabit.completedDates || []);
    
    habitsList.forEach(h => {
        if(h.id === anchorHabit.id) return;
        let overlap = 0;
        (h.completedDates || []).forEach(d => { if(anchorDates.has(d)) overlap++; });
        if(overlap >= maxOverlap) { maxOverlap = overlap; correlatedHabit = h; }
    });

    if (correlationTextDOM) {
        if (correlatedHabit && maxOverlap > 0) {
            const percentage = Math.round((maxOverlap / anchorDates.size) * 100);
            correlationTextDOM.innerHTML = `<strong>Insight:</strong> When you complete <span class="text-pure">'${anchorHabit.name}'</span>, you are <strong>${percentage}% more likely</strong> to complete <span class="text-pure">'${correlatedHabit.name}'</span>.`;
        } else {
            correlationTextDOM.innerHTML = `<strong>Insight:</strong> <span class="text-pure">'${anchorHabit.name}'</span> is your most consistent protocol.`;
        }
    }
}

// ==========================================
// DAILY SUMMARY OVERLAY ENGINE
// ==========================================
const dailyBaselineTarget = document.getElementById('dailyBaselineClickTarget');
const dailySummaryModalOverlay = document.getElementById('dailySummaryModalOverlay');
const dailySummaryModalCard = document.getElementById('dailySummaryModalCard');
const closeSummaryModalBtn = document.getElementById('closeSummaryModalBtn');
const summaryCompletedList = document.getElementById('summaryCompletedList');
const summaryPendingList = document.getElementById('summaryPendingList');
const summaryCurrentDay = document.getElementById('summaryCurrentDay');

function formatCompletionTime(timestamp) {
    if (!timestamp) return "";
    const dateObj = typeof timestamp.toDate === 'function' ? timestamp.toDate() : new Date(timestamp);
    return dateObj.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

dailyBaselineTarget?.addEventListener('click', () => {
    if (summaryCurrentDay) {
        const today = new Date();
        summaryCurrentDay.textContent = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    }

    if (summaryCompletedList) summaryCompletedList.innerHTML = '';
    if (summaryPendingList) summaryPendingList.innerHTML = '';

    let completedCount = 0;
    let pendingCount = 0;

    Object.values(activeHabitsMap).forEach(habit => {
        if (habit.status !== "active") return;

        const isDone = isCompletedToday(habit.lastCompletedAt);
        
        if (isDone) {
            completedCount++;
            const timeStr = formatCompletionTime(habit.lastCompletedAt);
            const html = `
                <div class="summary-item completed">
                    <div class="d-flex align-items-center gap-2">
                        <span>${habit.icon || "🎯"}</span>
                        <span class="summary-item-name">${habit.name}</span>
                    </div>
                    <span class="summary-item-time" style="color: var(--cyber-yellow);">${timeStr}</span>
                </div>
            `;
            summaryCompletedList?.insertAdjacentHTML('beforeend', html);
        } else {
            pendingCount++;
            const html = `
                <div class="summary-item pending">
                    <div class="d-flex align-items-center gap-2">
                        <span style="opacity: 0.5;">${habit.icon || "🎯"}</span>
                        <span class="summary-item-name" style="color: var(--text-muted);">${habit.name}</span>
                    </div>
                    <span class="summary-item-time">Pending</span>
                </div>
            `;
            summaryPendingList?.insertAdjacentHTML('beforeend', html);
        }
    });

    if (completedCount === 0 && summaryCompletedList) {
        summaryCompletedList.innerHTML = `<div class="text-muted" style="font-size: 13px; padding: 4px;">No protocols executed yet today.</div>`;
    }
    if (pendingCount === 0 && summaryPendingList) {
        summaryPendingList.innerHTML = `<div class="text-muted" style="font-size: 13px; padding: 4px;">All protocols cleared. Optimal performance.</div>`;
    }

    if (dailySummaryModalOverlay && dailySummaryModalCard) {
        dailySummaryModalOverlay.classList.remove('d-none');
        gsap.set(dailySummaryModalCard, { y: 50, opacity: 0 });
        const tl = gsap.timeline();
        tl.to(dailySummaryModalOverlay, { opacity: 1, duration: 0.2, ease: "power2.out" })
          .to(dailySummaryModalCard, { y: 0, opacity: 1, duration: 0.3, ease: "power3.out" }, "-=0.1");
    }
});

function closeSummaryModal() {
    if (dailySummaryModalCard) gsap.to(dailySummaryModalCard, { y: 30, opacity: 0, duration: 0.2, ease: "power2.in" });
    if (dailySummaryModalOverlay) {
        gsap.to(dailySummaryModalOverlay, { opacity: 0, duration: 0.2, ease: "power2.in", onComplete: () => {
            dailySummaryModalOverlay.classList.add('d-none');
        }});
    }
}

closeSummaryModalBtn?.addEventListener('click', closeSummaryModal);
dailySummaryModalOverlay?.addEventListener('click', (e) => { if (e.target === dailySummaryModalOverlay) closeSummaryModal(); });

// ==========================================
// ADVANCED HUD DIAGNOSTICS ENGINE
// ==========================================
const diagnosticsClickTarget = document.getElementById('diagnosticsClickTarget');
const diagnosticsModalOverlay = document.getElementById('diagnosticsModalOverlay');
const diagnosticsModalCard = document.getElementById('diagnosticsModalCard');
const closeDiagnosticsBtn = document.getElementById('closeDiagnosticsBtn');

if (diagnosticsClickTarget) {
    diagnosticsClickTarget.addEventListener('mouseenter', () => {
        diagnosticsClickTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
        diagnosticsClickTarget.style.boxShadow = '0 12px 32px rgba(0, 0, 0, 0.3)';
    });
    diagnosticsClickTarget.addEventListener('mouseleave', () => {
        diagnosticsClickTarget.style.borderColor = 'var(--logo-dormant)';
        diagnosticsClickTarget.style.boxShadow = 'none';
    });

    diagnosticsClickTarget.addEventListener('click', () => {
        let localApex = 0, activeStreaksCount = 0, completedToday = 0;
        let totalActiveHabits = 0, completionsLast7Days = 0;
        let deepWorkToday = 0, deepWorkLast7Days = 0;

        const habitsList = Object.values(activeHabitsMap);
        const todayStr = getLocalDateString();
        const last7Dates = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(); d.setDate(d.getDate() - i);
            last7Dates.push(getLocalDateString(d));
        }

        habitsList.forEach(habit => {
            if (habit.status !== "active") return;
            totalActiveHabits++;

            const streak = habit.telemetry ? habit.telemetry.currentStreak : 0;
            if (streak > localApex) localApex = streak;
            if (streak > 0) activeStreaksCount++;

            const focusHistory = habit.telemetry?.focusHistory || {};
            if (focusHistory[todayStr]) deepWorkToday += focusHistory[todayStr];
            last7Dates.forEach(dateStr => { if (focusHistory[dateStr]) deepWorkLast7Days += focusHistory[dateStr]; });

            if (isCompletedToday(habit.lastCompletedAt)) completedToday++;

            const completedDates = habit.completedDates || [];
            last7Dates.forEach(dateStr => { if (completedDates.includes(dateStr)) completionsLast7Days++; });
        });

        let actionableHabits = 0;
        habitsList.forEach(h => {
            if (h.status === "active" && (isCompletedToday(h.lastCompletedAt) || isHabitPendingToday(h))) actionableHabits++;
        });
        
        const pendingToday = actionableHabits - completedToday;
        const weeklyRate = totalActiveHabits > 0 ? Math.round((completionsLast7Days / (totalActiveHabits * 7)) * 100) : 0;

        const elementsToUpdate = [
            { id: 'diagApexStreak', val: localApex },
            { id: 'diagActiveStreaks', val: activeStreaksCount },
            { id: 'diagTodayWork', val: deepWorkToday },
            { id: 'diag7DayWork', val: deepWorkLast7Days },
            { id: 'diagCompletedToday', val: completedToday },
            { id: 'diagPendingToday', val: Math.max(0, pendingToday) },
            { id: 'diagWeeklyRate', val: `${weeklyRate}%` }
        ];

        elementsToUpdate.forEach(item => {
            const el = document.getElementById(item.id);
            if (el) el.textContent = item.val;
        });

        if (diagnosticsModalOverlay && diagnosticsModalCard) {
            diagnosticsModalOverlay.classList.remove('d-none');
            gsap.set(diagnosticsModalCard, { y: 50, opacity: 0, scale: 0.95 });
            const tl = gsap.timeline();
            tl.to(diagnosticsModalOverlay, { opacity: 1, duration: 0.2, ease: "power2.out" })
              .to(diagnosticsModalCard, { y: 0, opacity: 1, scale: 1, duration: 0.3, ease: "back.out(1.2)" }, "-=0.1");
        }
    });
}

function closeDiagnosticsModal() {
    if (diagnosticsModalCard) gsap.to(diagnosticsModalCard, { y: 30, opacity: 0, scale: 0.95, duration: 0.2, ease: "power2.in" });
    if (diagnosticsModalOverlay) {
        gsap.to(diagnosticsModalOverlay, { opacity: 0, duration: 0.2, ease: "power2.in", onComplete: () => {
            diagnosticsModalOverlay.classList.add('d-none');
        }});
    }
}

closeDiagnosticsBtn?.addEventListener('click', closeDiagnosticsModal);
diagnosticsModalOverlay?.addEventListener('click', (e) => { if (e.target === diagnosticsModalOverlay) closeDiagnosticsModal(); });

// ==========================================
// ANALYTICS MODALS (INTERACTIVE POPUPS)
// ==========================================
const analyticsModalOverlay = document.getElementById('analyticsModalOverlay');
const analyticsModalCard = document.getElementById('analyticsModalCard');
const closeAnalyticsModalBtn = document.getElementById('closeAnalyticsModalBtn');
const analyticsModalTitle = document.getElementById('analyticsModalTitle');
const analyticsModalSubtitle = document.getElementById('analyticsModalSubtitle');
const analyticsModalContent = document.getElementById('analyticsModalContent');

function openAnalyticsModal(title, subtitle, contentHTML, wideMode = false) {
    if (analyticsModalTitle) analyticsModalTitle.textContent = title;
    if (analyticsModalSubtitle) analyticsModalSubtitle.textContent = subtitle;
    if (analyticsModalContent) analyticsModalContent.innerHTML = contentHTML;

    if (analyticsModalCard) analyticsModalCard.style.maxWidth = wideMode ? "900px" : "700px";

    if (analyticsModalOverlay && analyticsModalCard) {
        analyticsModalOverlay.classList.remove('d-none');
        gsap.set(analyticsModalCard, { y: 50, opacity: 0 });
        const tl = gsap.timeline();
        tl.to(analyticsModalOverlay, { opacity: 1, duration: 0.2, ease: "power2.out" })
          .to(analyticsModalCard, { y: 0, opacity: 1, duration: 0.3, ease: "power3.out" }, "-=0.1");
    }
}

document.getElementById('cardBaselineScore')?.addEventListener('click', () => {
    let perfectDays = 0, zeroDays = 0, bestDay = "N/A", bestDayCount = 0;
    const heatmapData = {};
    Object.values(activeHabitsMap).forEach(h => { (h.completedDates || []).forEach(d => { heatmapData[d] = (heatmapData[d] || 0) + 1; }); });

    for (let i = 0; i < 30; i++) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const str = getLocalDateString(d);
        const comps = heatmapData[str] || 0;
        let activeOnDay = 0;
        Object.values(activeHabitsMap).forEach(h => {
            const created = h.createdAt && typeof h.createdAt.toDate === 'function' ? h.createdAt.toDate() : new Date();
            if (created <= new Date(str + 'T23:59:59')) activeOnDay++;
        });

        if (comps === activeOnDay && activeOnDay > 0) perfectDays++;
        if (comps === 0) zeroDays++;
        if (comps > bestDayCount) { bestDayCount = comps; bestDay = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }); }
    }

    const html = `<div class="row g-3"><div class="col-6"><div class="detail-stat-block"><div class="stat-label">Flawless Days (Last 30)</div><div class="stat-value text-pure">${perfectDays}</div></div></div><div class="col-6"><div class="detail-stat-block"><div class="stat-label">Zero-Action Days</div><div class="stat-value text-danger">${zeroDays}</div></div></div><div class="col-12"><div class="detail-stat-block text-center" style="border-color: rgba(212, 255, 0, 0.3);"><div class="stat-label mb-1">Apex Productivity Day</div><div class="stat-value" style="color: var(--cyber-yellow); font-size: 20px;">${bestDay}</div><div style="font-size: 13px; color: var(--text-muted); margin-top: 4px;">${bestDayCount} protocols successfully executed</div></div></div></div>`;
    openAnalyticsModal("Health Overview", "30-day baseline integrity metrics", html);
});

const cardRadar = document.getElementById('dayOfWeekChart')?.closest('.bento-card');
if (cardRadar) {
    cardRadar.style.cursor = 'pointer';
    cardRadar.addEventListener('click', () => {
        const dayCounts = { 0:0, 1:0, 2:0, 3:0, 4:0, 5:0, 6:0 };
        const heatmapData = {};
        Object.values(activeHabitsMap).forEach(h => { (h.completedDates || []).forEach(d => { heatmapData[d] = (heatmapData[d]||0) + 1; }); });
        for(let i = 0; i < 90; i++) { const d = new Date(); d.setDate(d.getDate() - i); dayCounts[d.getDay()] += (heatmapData[getLocalDateString(d)] || 0); }
        const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        let strongestDay = 0, weakestDay = 0, maxV = -1, minV = 99999;
        Object.entries(dayCounts).forEach(([dayIdx, vol]) => { if (vol > maxV) { maxV = vol; strongestDay = dayIdx; } if (vol < minV) { minV = vol; weakestDay = dayIdx; } });

        const html = `<div class="row g-3"><div class="col-12 col-md-6"><div class="detail-stat-block" style="border-color: rgba(212, 255, 0, 0.3);"><div class="stat-label">Strongest Day</div><div class="stat-value" style="color: var(--cyber-yellow); font-size: 20px;">${daysOfWeek[strongestDay]}</div><div style="font-size: 12px; color: var(--text-muted);">${maxV} lifetime executions</div></div></div><div class="col-12 col-md-6"><div class="detail-stat-block" style="border-color: rgba(255, 176, 32, 0.3);"><div class="stat-label">Weakest Day</div><div class="stat-value text-danger" style="font-size: 20px;">${daysOfWeek[weakestDay]}</div><div style="font-size: 12px; color: var(--text-muted);">${minV} lifetime executions</div></div></div><div class="col-12 mt-3"><p class="diagnostic-text mb-0" style="padding: 16px; background: rgba(255,255,255,0.02); border-radius: 12px;"><strong>Diagnostic:</strong> Historical data shows high failure rates on ${daysOfWeek[weakestDay]}s. Consider reducing protocol load on this day to protect streaks.</p></div></div>`;
        openAnalyticsModal("Weekly Radar Insights", "90-day day-of-week volume analysis", html);
    });
}

document.getElementById('cardCorrelation')?.addEventListener('click', () => {
    const habitsList = Object.values(activeHabitsMap).filter(h => h.status === 'active');
    if (habitsList.length < 2) return openAnalyticsModal("Synergy Mapping", "Behavioral Correlation", `<div class="text-center py-5 text-muted">Insufficient telemetry data.</div>`);

    let anchorHabit = null; let maxComps = 0;
    habitsList.forEach(h => { const comps = (h.completedDates || []).length; if(comps > maxComps) { maxComps = comps; anchorHabit = h; } });
    if (!anchorHabit || maxComps === 0) return openAnalyticsModal("Synergy Mapping", "Behavioral Correlation", `<div class="text-center py-5 text-muted">Awaiting protocol execution data.</div>`);

    const anchorDates = new Set(anchorHabit.completedDates || []);
    const correlations = [];
    habitsList.forEach(h => {
        if (h.id === anchorHabit.id) return;
        let overlap = 0;
        (h.completedDates || []).forEach(d => { if(anchorDates.has(d)) overlap++; });
        const percentage = anchorDates.size > 0 ? Math.round((overlap / anchorDates.size) * 100) : 0;
        correlations.push({ name: h.name, icon: h.icon || "🎯", percentage: percentage });
    });
    correlations.sort((a, b) => b.percentage - a.percentage);

    let listHTML = '';
    correlations.forEach(c => {
        let barColor = "var(--logo-dormant)"; 
        if (c.percentage >= 70) barColor = "var(--cyber-yellow)"; 
        else if (c.percentage >= 40) barColor = "#A3CC00"; 
        listHTML += `<div class="mb-4"><div class="d-flex justify-content-between align-items-center mb-2"><span style="font-size: 15px; color: var(--text-pure); font-weight: 500;">${c.icon} ${c.name}</span><span style="font-size: 14px; font-weight: 700; color: ${barColor};">${c.percentage}%</span></div><div class="baseline-track" style="height: 6px; background-color: rgba(255,255,255,0.05);"><div class="baseline-fill" style="width: ${c.percentage}%; background-color: ${barColor}; box-shadow: none;"></div></div></div>`;
    });

    const finalHTML = `<div class="detail-stat-block mb-4 text-center" style="border-color: rgba(212, 255, 0, 0.3); background-color: rgba(212, 255, 0, 0.05);"><div class="stat-label mb-2 text-pure">Keystone Protocol (Anchor)</div><div style="font-size: 24px; font-weight: 700; color: var(--cyber-yellow);">${anchorHabit.icon} ${anchorHabit.name}</div><div class="mt-2" style="font-size: 13px; color: var(--text-muted);">When this protocol is executed, here is your statistical probability of executing others on the same day:</div></div><div class="px-2 pb-2" style="max-height: 40vh; overflow-y: auto;">${listHTML}</div>`;
    openAnalyticsModal("Synergy Mapping", "Behavioral probability analysis", finalHTML);
});

document.getElementById('cardMonthlyTrend')?.addEventListener('click', () => {
    const weekData = [0, 0, 0, 0]; 
    const heatmapData = {};
    Object.values(activeHabitsMap).forEach(h => { (h.completedDates || []).forEach(d => { heatmapData[d] = (heatmapData[d] || 0) + 1; }); });
    
    let totalMonth = 0;
    for(let i = 0; i < 28; i++) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const count = heatmapData[getLocalDateString(d)] || 0;
        totalMonth += count;
        const wIndex = Math.floor(i / 7); 
        weekData[wIndex] += count;
    }
    
    const currentVsPast = weekData[0] - weekData[1];
    let trajectoryText = "";
    if (currentVsPast > 0) trajectoryText = `<span style="color: var(--cyber-yellow);">↑ Up ${currentVsPast} executions</span> <span style="color: var(--text-muted); font-weight: 400; font-size: 14px; margin-left: 4px;">vs last week</span>`;
    else if (currentVsPast < 0) trajectoryText = `<span class="text-danger">↓ Down ${Math.abs(currentVsPast)} executions</span> <span style="color: var(--text-muted); font-weight: 400; font-size: 14px; margin-left: 4px;">vs last week</span>`;
    else trajectoryText = `<span style="color: var(--text-pure);">— Stable</span> <span style="color: var(--text-muted); font-weight: 400; font-size: 14px; margin-left: 4px;">vs last week</span>`;

    const html = `
        <div class="row g-3">
            <div class="col-12">
                <div class="detail-stat-block text-center mb-1">
                    <div class="stat-label">Total Executions (Last 28 Days)</div>
                    <div class="stat-value text-pure" style="font-size: 32px;">${totalMonth}</div>
                </div>
            </div>
            <div class="col-12 col-md-6">
                <div class="detail-stat-block">
                    <div class="stat-label">This Week</div>
                    <div class="stat-value text-pure">${weekData[0]}</div>
                </div>
            </div>
            <div class="col-12 col-md-6">
                <div class="detail-stat-block">
                    <div class="stat-label">Last Week</div>
                    <div class="stat-value text-muted">${weekData[1]}</div>
                </div>
            </div>
            <div class="col-12 mt-3">
                <div class="detail-stat-block text-center" style="background: rgba(255,255,255,0.02); border-color: rgba(255,255,255,0.1);">
                    <div class="stat-label mb-2">Momentum Trajectory</div>
                    <div style="font-size: 16px; font-weight: 600;">${trajectoryText}</div>
                </div>
            </div>
        </div>`;
        
    openAnalyticsModal("30-Day Trajectory", "Recent volume trends and velocity", html);
});

document.getElementById('cardTopography')?.addEventListener('click', (e) => {
    if (!e.target.closest('.heatmap-grid')) return;

    const layoutHTML = `
        <div class="row g-4">
            <div class="col-12 col-md-7">
                <div class="calendar-scroll-area" style="max-height: 55vh; overflow-y: auto; padding-right: 12px;" id="fullYearCalendarContainer"></div>
            </div>
            <div class="col-12 col-md-5">
                <div class="detail-stat-block h-100 position-sticky top-0" id="dayDetailPane" style="background-color: var(--bg-deep-space); border-color: rgba(212, 255, 0, 0.2);">
                    <div class="d-flex flex-column justify-content-center align-items-center h-100 text-center text-muted" style="min-height: 300px;">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="mb-3 opacity-50"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                        <div>Select a date on the calendar to view deep execution telemetry.</div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    openAnalyticsModal("Yearly Telemetry Archive", "Historical audit trail", layoutHTML, true);

    const calContainer = document.getElementById('fullYearCalendarContainer');
    const currentYear = new Date().getFullYear();
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    
    const heatmapData = {};
    Object.values(activeHabitsMap).forEach(habit => {
        (habit.completedDates || []).forEach(dateStr => { heatmapData[dateStr] = (heatmapData[dateStr] || 0) + 1; });
    });

    let calHTML = '';
    for(let m = 0; m < 12; m++) {
        const daysInMonth = new Date(currentYear, m + 1, 0).getDate();
        const firstDayOfWeek = new Date(currentYear, m, 1).getDay(); 
        
        let gridHTML = `<div class="calendar-grid mb-4">`;
        ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach(d => {
            gridHTML += `<div class="text-center text-muted" style="font-size: 10px; font-weight: 600;">${d}</div>`;
        });

        for(let empty = 0; empty < firstDayOfWeek; empty++) {
            gridHTML += `<div style="visibility: hidden;"></div>`;
        }

        for(let d = 1; d <= daysInMonth; d++) {
            const dateObj = new Date(currentYear, m, d);
            const dateStr = getLocalDateString(dateObj);
            const count = heatmapData[dateStr] || 0;
            
            let eligibleHabits = 0;
            Object.values(activeHabitsMap).forEach(h => {
                const createdAt = h.createdAt && typeof h.createdAt.toDate === 'function' ? h.createdAt.toDate() : new Date();
                if (createdAt <= dateObj) eligibleHabits++;
            });

            let percentage = 0;
            if (eligibleHabits > 0) percentage = Math.round((count / eligibleHabits) * 100);

            let levelClass = 'level-0';
            if (percentage > 0 && percentage <= 25) levelClass = 'level-1';
            else if (percentage > 25 && percentage <= 50) levelClass = 'level-2';
            else if (percentage > 50 && percentage <= 75) levelClass = 'level-3';
            else if (percentage > 75) levelClass = 'level-4';

            let extraClass = dateObj > new Date() ? 'future-date level-0' : '';
            gridHTML += `<div class="calendar-day ${levelClass} ${extraClass}" data-date="${dateStr}">${d}</div>`;
        }
        gridHTML += `</div>`; 
        calHTML += `<div class="month-block"><h6 class="text-pure mb-2" style="font-size: 14px;">${monthNames[m]}</h6>${gridHTML}</div>`;
    }
    calContainer.innerHTML = calHTML;

    function updateDayDetailPane(dateStr) {
        const pane = document.getElementById('dayDetailPane');
        if(!pane) return;
        const dateObj = new Date(dateStr);
        const displayDate = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

        let completedHabits = [], missedHabits = [], deepWorkTotal = 0;

        Object.values(activeHabitsMap).forEach(habit => {
            if (habit.status !== 'active') return;
            const createdAt = habit.createdAt && typeof habit.createdAt.toDate === 'function' ? habit.createdAt.toDate() : new Date();
            if (createdAt > new Date(dateStr + 'T23:59:59')) return;

            const isDone = (habit.completedDates || []).includes(dateStr);
            if (isDone) completedHabits.push({ name: habit.name, icon: habit.icon || "🎯" });
            else missedHabits.push({ name: habit.name, icon: habit.icon || "🎯" });

            if (habit.telemetry?.focusHistory?.[dateStr]) {
                deepWorkTotal += habit.telemetry.focusHistory[dateStr];
            }
        });

        let compHTML = completedHabits.length > 0 
            ? completedHabits.map(h => `<div class="summary-item completed mb-2"><div class="d-flex align-items-center gap-2"><span>${h.icon}</span><span class="summary-item-name">${h.name}</span></div><span class="summary-item-time" style="color: var(--cyber-yellow);">Executed</span></div>`).join('')
            : `<div class="text-muted mb-3" style="font-size: 13px;">No protocols executed.</div>`;

        let missHTML = missedHabits.length > 0
            ? missedHabits.map(h => `<div class="summary-item pending mb-2"><div class="d-flex align-items-center gap-2"><span style="opacity:0.5;">${h.icon}</span><span class="summary-item-name" style="color: var(--text-muted);">${h.name}</span></div><span class="summary-item-time text-danger">Unexecuted</span></div>`).join('')
            : `<div class="text-muted" style="font-size: 13px;">No unexecuted protocols.</div>`;

        pane.innerHTML = `
            <h4 class="mb-3 text-pure text-center pb-3 border-bottom" style="font-size: 16px; border-color: var(--logo-dormant) !important;">${displayDate}</h4>
            <div class="mb-4 text-center">
                <div class="stat-label mb-1" style="color: #A3CC00;">Deep Work Logged</div>
                <div style="font-size: 24px; font-weight: 700; color: var(--text-pure);">${deepWorkTotal} <span style="font-size: 12px; font-weight: 500; color: var(--text-muted);">mins</span></div>
            </div>
            <div class="mb-4" style="max-height: 200px; overflow-y: auto; padding-right: 4px;"><div class="stat-label mb-2">Executed (${completedHabits.length})</div>${compHTML}</div>
            <div style="max-height: 200px; overflow-y: auto; padding-right: 4px;"><div class="stat-label mb-2" style="color: var(--diagnostic-amber);">Unexecuted (${missedHabits.length})</div>${missHTML}</div>
        `;
    }

    const daysNodes = calContainer.querySelectorAll('.calendar-day:not(.future-date)');
    daysNodes.forEach(dayEl => {
        dayEl.addEventListener('click', (e) => {
            daysNodes.forEach(d => d.classList.remove('active-select'));
            e.target.classList.add('active-select');
            updateDayDetailPane(e.target.getAttribute('data-date'));
        });
    });

    const todayStrLocal = getLocalDateString(); 
    const todayElement = calContainer.querySelector(`.calendar-day[data-date="${todayStrLocal}"]`);
    
    if (todayElement) {
        setTimeout(() => {
            daysNodes.forEach(d => d.classList.remove('active-select'));
            todayElement.classList.add('active-select');
            updateDayDetailPane(todayStrLocal);
            todayElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
    }
});

function closeAnalyticsModalEngine() {
    if (analyticsModalCard) gsap.to(analyticsModalCard, { y: 30, opacity: 0, duration: 0.2, ease: "power2.in" });
    if (analyticsModalOverlay) {
        gsap.to(analyticsModalOverlay, { opacity: 0, duration: 0.2, ease: "power2.in", onComplete: () => {
            analyticsModalOverlay.classList.add('d-none');
            if (analyticsModalCard) analyticsModalCard.style.maxWidth = "700px"; 
        }});
    }
}

closeAnalyticsModalBtn?.addEventListener('click', closeAnalyticsModalEngine);
analyticsModalOverlay?.addEventListener('click', (e) => { if (e.target === analyticsModalOverlay) closeAnalyticsModalEngine(); });

// ==========================================
// SETTINGS & DATA MANAGEMENT ENGINE
// ==========================================
document.getElementById('themeToggleSwitch')?.addEventListener('change', (e) => {
    if (e.target.checked) {
        document.body.classList.add('light-mode');
        localStorage.setItem('baseline_theme', 'light');
    } else {
        document.body.classList.remove('light-mode');
        localStorage.setItem('baseline_theme', 'dark');
    }
});

document.getElementById('profileUpdateForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!auth.currentUser) return;
    
    const settingsNameInput = document.getElementById('settingsNameInput');
    const saveProfileBtn = document.getElementById('saveProfileBtn');
    const profileSuccessMsg = document.getElementById('profileSuccessMsg');
    
    const newName = settingsNameInput.value.trim();
    const origText = saveProfileBtn.textContent;
    saveProfileBtn.textContent = "SAVING...";
    saveProfileBtn.disabled = true;

    try {
        await updateProfile(auth.currentUser, { displayName: newName });
        const userRef = doc(db, "Users", auth.currentUser.uid);
        await updateDoc(userRef, { displayName: newName });

        const userGreeting = document.getElementById('userGreeting');
        if (userGreeting) userGreeting.textContent = `Welcome, ${newName || auth.currentUser.email.split('@')[0]}.`;

        if (profileSuccessMsg) {
            profileSuccessMsg.style.display = 'block';
            setTimeout(() => { profileSuccessMsg.style.display = 'none'; }, 3000);
        }
    } catch (error) {
        console.error(error);
        alert("Network error. Failed to update profile.");
    } finally {
        saveProfileBtn.textContent = origText;
        saveProfileBtn.disabled = false;
    }
});

const saveFocusSettingsBtn = document.getElementById('saveFocusSettingsBtn');
saveFocusSettingsBtn?.addEventListener('click', () => {
    const settingFocusWork = document.getElementById('settingFocusWork');
    const settingFocusRest = document.getElementById('settingFocusRest');
    const w = parseInt(settingFocusWork?.value);
    const r = parseInt(settingFocusRest?.value);

    if (w && r) {
        localStorage.setItem('baseline_focus_work', w);
        localStorage.setItem('baseline_focus_rest', r);
        
        cachedFocusSettings.work = w;
        cachedFocusSettings.rest = r;

        const origText = saveFocusSettingsBtn.textContent;
        saveFocusSettingsBtn.textContent = "Saved to Local Memory";
        saveFocusSettingsBtn.style.color = "var(--cyber-yellow)";
        
        setTimeout(() => { 
            saveFocusSettingsBtn.textContent = origText; 
            saveFocusSettingsBtn.style.color = "var(--cyber-yellow)"; 
        }, 2000);
    }
});

const settingStartOfWeek = document.getElementById('settingStartOfWeek');
const notifyMorningToggle = document.getElementById('notifyMorningToggle');
const notifyWeeklyToggle = document.getElementById('notifyWeeklyToggle');

async function updateSystemSettings() {
    if (!auth.currentUser) return;
    const userRef = doc(db, "Users", auth.currentUser.uid);
    try {
        await updateDoc(userRef, {
            "settings.startOfWeek": settingStartOfWeek ? settingStartOfWeek.value : 'monday',
            "settings.notifyMorning": notifyMorningToggle ? notifyMorningToggle.checked : true,
            "settings.notifyWeekly": notifyWeeklyToggle ? notifyWeeklyToggle.checked : true
        });
        
        if (settingStartOfWeek) {
            localStorage.setItem('baseline_start_of_week', settingStartOfWeek.value);
            if (document.getElementById('mainAnalytics') && !document.getElementById('mainAnalytics').classList.contains('d-none')) {
                renderAnalyticsUI();
            }
        }
    } catch (e) {
        console.error("Failed to sync settings to cloud.", e);
    }
}

settingStartOfWeek?.addEventListener('change', updateSystemSettings);
notifyMorningToggle?.addEventListener('change', updateSystemSettings);
notifyWeeklyToggle?.addEventListener('change', updateSystemSettings);

const exportCsvBtn = document.getElementById('exportCsvBtn');
exportCsvBtn?.addEventListener('click', async () => {
    if (!auth.currentUser) return;
    const origText = exportCsvBtn.innerHTML;
    exportCsvBtn.innerHTML = "Extracting Telemetry...";
    exportCsvBtn.disabled = true;

    try {
        const logRef = collection(db, "Users", auth.currentUser.uid, "ExecutionLog");
        const q = query(logRef, orderBy("timestamp", "desc"));
        const snap = await getDocs(q);

        let csvContent = "Date,Time,Protocol,Type,Duration_Mins,Failure_Notes\n";

        snap.forEach(docSnap => {
            const data = docSnap.data();
            const d = data.timestamp ? data.timestamp.toDate() : new Date();
            const dateStr = d.toLocaleDateString();
            const timeStr = d.toLocaleTimeString();
            
            const note = data.note ? `"${data.note.replace(/"/g, '""')}"` : "";
            const duration = data.duration || "";
            const type = data.type || "success";
            
            csvContent += `${dateStr},${timeStr},"${data.habitName}",${type},${duration},${note}\n`;
        });

        // Bug fix implemented here: Using Blob to prevent URI character limits
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `Baseline_Telemetry_${getLocalDateString()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url); // Clean up memory

    } catch (e) {
        console.error(e);
        alert("Network error. Failed to export telemetry.");
    } finally {
        exportCsvBtn.innerHTML = origText;
        exportCsvBtn.disabled = false;
    }
});

const deleteAccountBtn = document.getElementById('deleteAccountBtn');
deleteAccountBtn?.addEventListener('click', async () => {
    if (!auth.currentUser) return;
    
    if (!confirm("WARNING: This will permanently delete your Baseline account and all telemetry data. This cannot be undone. Proceed?")) return;
    if (prompt("To confirm termination, type 'TERMINATE' below:") !== 'TERMINATE') return;

    try {
        deleteAccountBtn.textContent = "Terminating...";
        deleteAccountBtn.disabled = true;

        const userRef = doc(db, "Users", auth.currentUser.uid);
        await deleteDoc(userRef);
        await deleteUser(auth.currentUser);
        
        localStorage.clear();
        window.location.reload();
        
    } catch (e) {
        console.error(e);
        if (e.code === 'auth/requires-recent-login') {
            alert("Security Lock: Please log out and log back in to verify your identity before deleting this account.");
        } else {
            alert("Failed to terminate account. Please ensure you have a stable connection.");
        }
        deleteAccountBtn.textContent = "Terminate Account";
        deleteAccountBtn.disabled = false;
    }
});