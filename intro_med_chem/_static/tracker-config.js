// Simplified Configuration for Student Activity Tracker
const TRACKER_CONFIG = {
    // Power Automate Webhook URL (you'll get this after creating the flow)
    POWER_AUTOMATE_URL: 'https://default5ba5ef5e31094e7785bdcfeb0d347e.82.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/43b2436880d343a2923cddfef2e1b26a/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=Czh-rUJsaHNjUc1KWxy5ybp8Z8tm9Wc0MuiVKDGdAcg', // Replace with actual URL
    
    // Authentication API endpoint (Power Automate flow for login verification)
    AUTH_VERIFY_URL: 'https://default5ba5ef5e31094e7785bdcfeb0d347e.82.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/909f32408f5347b2b798a3d790dee0a7/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=R_Qdk0ZgDx4Ub7pX1xecvRUdJAL7BHGcvzYyGbpoOUc', // Replace with actual URL
    

    // Excel file details
    EXCEL_FILE_PATH: 'YOUR_EXCEL_FILE_PATH',
    EXCEL_SHEET_NAME: 'Sheet1',
    
    // Settings
    DEBUG_MODE: true, // Set to false in production
    
    // Storage keys
    STORAGE_KEYS: {
        STUDENT_ID: 'medchem_student_id',
        STUDENT_EMAIL: 'medchem_student_email',
        SESSION_ID: 'medchem_session_id',
        AUTH_TOKEN: 'medchem_auth_token',
        OFFLINE_QUEUE: 'medchem_offline_queue',
        TRACKING_CONSENT: 'medchem_tracking_consent'
    }
};