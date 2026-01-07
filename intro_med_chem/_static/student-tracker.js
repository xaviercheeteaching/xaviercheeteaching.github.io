// Simplified Student Activity Tracker - Page Views Only
class StudentTracker {
    constructor() {
        this.config = TRACKER_CONFIG;
        this.isOnline = navigator.onLine;
        
        this.init();
    }

    init() {
        // Check if user has consented to tracking
        if (!this.hasTrackingConsent()) {
            return;
        }

        // Track this page view
        this.trackPageView();
        
        // Setup online/offline detection
        this.setupOnlineStatusTracking();

        if (this.config.DEBUG_MODE) {
            console.log('Student Tracker initialized - Page view tracked');
        }
    }

    hasTrackingConsent() {
        return localStorage.getItem(this.config.STORAGE_KEYS.TRACKING_CONSENT) === 'true';
    }

    getStudentId() {
        return localStorage.getItem(this.config.STORAGE_KEYS.STUDENT_ID) || 'unknown';
    }

    getSessionId() {
        return localStorage.getItem(this.config.STORAGE_KEYS.SESSION_ID) || 'unknown';
    }

    getPageInfo() {
        const path = window.location.pathname;
        const pageTitle = document.title;
        const chapterMatch = pageTitle.match(/Chapter\s+(\d+)/i) || pageTitle.match(/^(\d+\.\d+)/);
        const chapter = chapterMatch ? `Chapter ${chapterMatch[1]}` : 'Unknown';
        
        return {
            page: pageTitle || 'Untitled Page',
            chapter: chapter,
            url: window.location.href,
            path: path
        };
    }

    createEvent() {
        const pageInfo = this.getPageInfo();
        
        return {
            studentId: this.getStudentId(),
            sessionId: this.getSessionId(),
            page: pageInfo.page,
            chapter: pageInfo.chapter,
            url: pageInfo.url,
            timestamp: new Date().toISOString()
        };
    }

    trackPageView() {
        const event = this.createEvent();
        this.sendEvent(event);
    }

    async sendEvent(event) {
        if (!this.isOnline) {
            this.saveToOfflineQueue(event);
            return;
        }

        try {
            if (this.config.DEBUG_MODE) {
                console.log('Sending page view:', event);
            }

            const response = await fetch(this.config.POWER_AUTOMATE_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(event)
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            if (this.config.DEBUG_MODE) {
                console.log('Page view sent successfully');
            }

            // Try to send offline queue if it exists
            this.sendOfflineQueue();

        } catch (error) {
            console.error('Failed to send page view:', error);
            this.saveToOfflineQueue(event);
        }
    }

    setupOnlineStatusTracking() {
        window.addEventListener('online', () => {
            this.isOnline = true;
            if (this.config.DEBUG_MODE) {
                console.log('Connection restored');
            }
            this.sendOfflineQueue();
        });

        window.addEventListener('offline', () => {
            this.isOnline = false;
            if (this.config.DEBUG_MODE) {
                console.log('Connection lost');
            }
        });
    }

    // ==================== OFFLINE QUEUE MANAGEMENT ====================
    saveToOfflineQueue(event) {
        try {
            const queue = this.loadOfflineQueue();
            queue.push(event);
            
            // Limit queue size to 50
            if (queue.length > 50) {
                queue.splice(0, queue.length - 50);
            }
            
            localStorage.setItem(
                this.config.STORAGE_KEYS.OFFLINE_QUEUE,
                JSON.stringify(queue)
            );

            if (this.config.DEBUG_MODE) {
                console.log('Saved to offline queue');
            }
        } catch (error) {
            console.error('Failed to save offline queue:', error);
        }
    }

    loadOfflineQueue() {
        try {
            const queueData = localStorage.getItem(this.config.STORAGE_KEYS.OFFLINE_QUEUE);
            return queueData ? JSON.parse(queueData) : [];
        } catch (error) {
            console.error('Failed to load offline queue:', error);
            return [];
        }
    }

    async sendOfflineQueue() {
        const queue = this.loadOfflineQueue();
        if (queue.length === 0) return;

        // Send each event individually
        for (const event of queue) {
            try {
                await fetch(this.config.POWER_AUTOMATE_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(event)
                });
            } catch (error) {
                console.error('Failed to send queued event:', error);
                return; // Stop if sending fails
            }
        }

        // Clear offline queue after successful send
        localStorage.removeItem(this.config.STORAGE_KEYS.OFFLINE_QUEUE);
        
        if (this.config.DEBUG_MODE) {
            console.log('Offline queue sent successfully');
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