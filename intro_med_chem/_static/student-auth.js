// Student Authentication System - Simplified
class StudentAuth {
    constructor() {
        this.config = TRACKER_CONFIG;
        this.isAuthenticated = false;
        this.studentEmail = null;
        this.checkAuth();
    }

    checkAuth() {
        // Simply check if email and password exist in localStorage
        const storedEmail = localStorage.getItem(this.config.STORAGE_KEYS.STUDENT_EMAIL);
        const storedPassword = localStorage.getItem(this.config.STORAGE_KEYS.STUDENT_PASSWORD);
        
        if (storedEmail && storedPassword) {
            // Credentials exist - user is logged in
            this.isAuthenticated = true;
            this.studentEmail = storedEmail;
            
            if (this.config.DEBUG_MODE) {
                console.log('Student already logged in:', storedEmail);
            }
            
            // Start tracker
            if (window.StudentTracker) {
                window.studentTracker = new StudentTracker();
            }
        } else {
            // No credentials - show login
            if (this.config.DEBUG_MODE) {
                console.log('No credentials found, showing login');
            }
            this.showLoginPrompt();
        }
    }

    showLoginPrompt() {
        // Block page content
        document.body.style.overflow = 'hidden';
        
        // Create overlay
        const overlay = document.createElement('div');
        overlay.id = 'auth-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(255, 255, 255, 0.98);
            z-index: 10000;
            display: flex;
            justify-content: center;
            align-items: center;
        `;

        // Create login form
        const loginBox = document.createElement('div');
        loginBox.style.cssText = `
            background: white;
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.15);
            max-width: 400px;
            width: 90%;
        `;

        loginBox.innerHTML = `
            <h2 style="margin: 0 0 10px 0; color: #333; font-family: Arial, sans-serif;">
                Student Login Required
            </h2>
            <p style="color: #666; margin-bottom: 25px; font-size: 14px;">
                Please sign in with your student credentials to access course materials.
            </p>
            
            <div id="auth-error" style="display: none; padding: 12px; background: #fee; border: 1px solid #fcc; border-radius: 6px; margin-bottom: 15px; color: #c33;">
            </div>
            
            <form id="student-login-form" style="display: flex; flex-direction: column; gap: 15px;">
                <div>
                    <label style="display: block; margin-bottom: 5px; color: #555; font-size: 14px; font-weight: 600;">
                        Email Address
                    </label>
                    <input 
                        type="email" 
                        id="student-email" 
                        required 
                        placeholder="your.email@university.edu"
                        style="width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; box-sizing: border-box;"
                    />
                </div>
                
                <div>
                    <label style="display: block; margin-bottom: 5px; color: #555; font-size: 14px; font-weight: 600;">
                        Password
                    </label>
                    <input 
                        type="password" 
                        id="student-password" 
                        required 
                        placeholder="Enter your password"
                        style="width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; box-sizing: border-box;"
                    />
                </div>
                
                <button 
                    type="submit" 
                    id="login-button"
                    style="padding: 12px; background: #2196F3; color: white; border: none; border-radius: 6px; font-size: 16px; font-weight: 600; cursor: pointer; transition: background 0.3s;"
                    onmouseover="this.style.background='#1976D2'" 
                    onmouseout="this.style.background='#2196F3'"
                >
                    Sign In
                </button>
            </form>
            
            <p style="margin-top: 20px; font-size: 12px; color: #999; text-align: center;">
                Your credentials are verified against the course database.
            </p>
        `;

        overlay.appendChild(loginBox);
        document.body.appendChild(overlay);

        // Attach event listener
        document.getElementById('student-login-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleLogin();
        });
    }

    hideLoginPrompt() {
        const overlay = document.getElementById('auth-overlay');
        if (overlay) {
            overlay.remove();
        }
        document.body.style.overflow = 'auto';
    }

    async handleLogin() {
        const email = document.getElementById('student-email').value.trim();
        const password = document.getElementById('student-password').value;
        const errorDiv = document.getElementById('auth-error');
        const loginButton = document.getElementById('login-button');

        // Show loading state
        loginButton.textContent = 'Verifying...';
        loginButton.disabled = true;
        errorDiv.style.display = 'none';

        try {
            // Send credentials to Power Automate for verification
            const response = await fetch(this.config.AUTH_VERIFY_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    action: 'login',
                    email: email,
                    password: password,
                    timestamp: new Date().toISOString()
                })
            });

            const result = await response.json();

            if (result.authenticated) {
                // Store credentials in localStorage
                const sessionId = this.generateSessionId();
                
                localStorage.setItem(this.config.STORAGE_KEYS.STUDENT_EMAIL, email);
                localStorage.setItem(this.config.STORAGE_KEYS.STUDENT_PASSWORD, password);
                localStorage.setItem(this.config.STORAGE_KEYS.STUDENT_ID, result.studentId || email);
                localStorage.setItem(this.config.STORAGE_KEYS.SESSION_ID, sessionId);
                localStorage.setItem(this.config.STORAGE_KEYS.TRACKING_CONSENT, 'true');

                this.isAuthenticated = true;
                this.studentEmail = email;
                
                if (this.config.DEBUG_MODE) {
                    console.log('Login successful, credentials stored');
                }
                
                // Hide login prompt
                this.hideLoginPrompt();
                
                // Initialize tracker
                if (window.StudentTracker) {
                    window.studentTracker = new StudentTracker();
                }
            } else {
                // Show error
                errorDiv.textContent = 'Invalid email or password. Please try again.';
                errorDiv.style.display = 'block';
                loginButton.textContent = 'Sign In';
                loginButton.disabled = false;
            }
        } catch (error) {
            console.error('Login error:', error);
            errorDiv.textContent = 'Connection error. Please check your internet and try again.';
            errorDiv.style.display = 'block';
            loginButton.textContent = 'Sign In';
            loginButton.disabled = false;
        }
    }

    generateSessionId() {
        return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    logout() {
        // Clear all stored data
        Object.values(this.config.STORAGE_KEYS).forEach(key => {
            localStorage.removeItem(key);
        });
        
        this.isAuthenticated = false;
        this.studentEmail = null;
        
        // Reload page to show login
        window.location.reload();
    }

    getStudentId() {
        return localStorage.getItem(this.config.STORAGE_KEYS.STUDENT_ID);
    }

    getSessionId() {
        return localStorage.getItem(this.config.STORAGE_KEYS.SESSION_ID);
    }
}

// Initialize authentication when page loads
let studentAuth;
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        studentAuth = new StudentAuth();
    });
} else {
    studentAuth = new StudentAuth();
}