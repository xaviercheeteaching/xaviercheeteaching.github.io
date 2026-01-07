// Ultra-Simplified Student Activity Tracker
// Tracks locally, sends only when leaving page
class StudentTracker {
    constructor() {
        this.config = TRACKER_CONFIG;
        this.sessionId = this.getOrCreateSessionId();
        this.pageLoadTime = Date.now();
        this.pageStartTime = new Date().toISOString();
        this.lastSaveTime = Date.now();
        
        this.init();
    }

    init() {
        if (!this.hasTrackingConsent()) {
            if (this.config.DEBUG_MODE) {
                console.log('Tracking consent not provided');
            }
            return;
        }

        // Save periodically as backup (every 5 minutes)
        this.startPeriodicSave();
        
        // Send final data before page unload
        this.setupBeforeUnload();

        if (this.config.DEBUG_MODE) {
            console.log('Tracker initialized', {
                sessionId: this.sessionId,
                studentId: this.getStudentId(),
                page: this.getPageInfo().page
            });
        }
    }

    hasTrackingConsent() {
        return localStorage.getItem(this.config.STORAGE_KEYS.TRACKING_CONSENT) === 'true';
    }

    getStudentId() {
        return localStorage.getItem(this.config.STORAGE_KEYS.STUDENT_ID) || 'unknown';
    }

    getOrCreateSessionId() {
        let sessionId = localStorage.getItem(this.config.STORAGE_KEYS.SESSION_ID);
        if (!sessionId) {
            sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem(this.config.STORAGE_KEYS.SESSION_ID, sessionId);
        }
        return sessionId;
    }

    getPageInfo() {
        const path = window.location.pathname;
        const pageTitle = document.title;
        
        const chapterMatch = pageTitle.match(/Chapter\s+(\d+)/i) || 
                           pageTitle.match(/^(\d+)\./);
        const chapter = chapterMatch ? `Chapter ${chapterMatch[1]}` : 'Unknown';
        
        return {
            page: pageTitle || 'Untitled Page',
            chapter: chapter,
            url: window.location.href,
            path: path
        };
    }

    getCurrentDuration() {
        // Calculate duration in seconds
        return Math.round((Date.now() - this.pageLoadTime) / 1000);
    }

    createPageEntry() {
        const pageInfo = this.getPageInfo();
        const duration = this.getCurrentDuration();
        const endTime = new Date().toISOString();
        
        return {
            studentId: this.getStudentId(),
            sessionId: this.sessionId,
            page: pageInfo.page,
            chapter: pageInfo.chapter,
            url: pageInfo.url,
            path: pageInfo.path,
            startTime: this.pageStartTime,
            endTime: endTime,
            duration: duration,
            userAgent: navigator.userAgent,
            screenResolution: `${screen.width}x${screen.height}`,
            timestamp: endTime
        };
    }

    // ==================== PERIODIC SAVE (BACKUP) ====================
    
    startPeriodicSave() {
        // Save every 5 minutes as backup in case browser crashes
        this.saveInterval = setInterval(() => {
            const timeSinceLastSave = Math.round((Date.now() - this.lastSaveTime) / 1000);
            
            // Only save if it's been at least 5 minutes
            if (timeSinceLastSave >= 300) {
                this.sendPageData();
                this.lastSaveTime = Date.now();
                
                if (this.config.DEBUG_MODE) {
                    console.log('Periodic backup save completed');
                }
            }
        }, 60000); // Check every minute
    }

    // ==================== SEND TO POWER AUTOMATE ====================
    
    async sendPageData() {
        const pageEntry = this.createPageEntry();

        try {
            if (this.config.DEBUG_MODE) {
                console.log('Sending to Power Automate:', pageEntry);
            }

            const response = await fetch(this.config.POWER_AUTOMATE_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(pageEntry)
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            if (this.config.DEBUG_MODE) {
                console.log('Successfully sent to Power Automate');
            }

        } catch (error) {
            console.error('Failed to send page data:', error);
        }
    }

    // ==================== PAGE UNLOAD ====================
    
    setupBeforeUnload() {
        window.addEventListener('beforeunload', () => {
            const pageEntry = this.createPageEntry();
            
            // Use sendBeacon for reliable sending during page unload
            if (navigator.sendBeacon) {
                const blob = new Blob(
                    [JSON.stringify(pageEntry)], 
                    { type: 'application/json' }
                );
                navigator.sendBeacon(this.config.POWER_AUTOMATE_URL, blob);
                
                if (this.config.DEBUG_MODE) {
                    console.log('Final data sent via sendBeacon:', pageEntry);
                }
            }
        });
        
        // Also try pagehide event (more reliable on mobile)
        window.addEventListener('pagehide', () => {
            const pageEntry = this.createPageEntry();
            
            if (navigator.sendBeacon) {
                const blob = new Blob(
                    [JSON.stringify(pageEntry)], 
                    { type: 'application/json' }
                );
                navigator.sendBeacon(this.config.POWER_AUTOMATE_URL, blob);
            }
        });
    }

    // ==================== CLEANUP ====================
    
    destroy() {
        if (this.saveInterval) {
            clearInterval(this.saveInterval);
        }
    }
}

// Initialize tracker when auth is complete
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        if (localStorage.getItem(TRACKER_CONFIG.STORAGE_KEYS.TRACKING_CONSENT) === 'true') {
            window.studentTracker = new StudentTracker();
        }
    });
} else {
    if (localStorage.getItem(TRACKER_CONFIG.STORAGE_KEYS.TRACKING_CONSENT) === 'true') {
        window.studentTracker = new StudentTracker();
    }
}