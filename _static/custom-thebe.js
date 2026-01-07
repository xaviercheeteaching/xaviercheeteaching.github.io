// Custom Thebe configuration for local kernel
// This overrides the default Thebe behavior to use local Jupyter server

window.thebeConfig = {
    // Request kernel from local Jupyter server
    requestKernel: true,

    // Disable Binder
    binderOptions: {
        repo: null,
        ref: null,
    },

    // Local server settings
    kernelOptions: {
        name: "python3",
        serverSettings: {
            baseUrl: "http://localhost:8888",
            wsUrl: "ws://localhost:8888",
            // Token will be read from environment or provided by user
            token: window.localStorage.getItem('jupyter-token') || "",
            appendToken: true,
        }
    },

    // Code mirror options
    codeMirrorConfig: {
        theme: "default",
        lineNumbers: true,
        lineWrapping: true,
    },

    // Mount local file system (optional)
    mountActivateWidget: false,

    // Always use local server
    alwaysUseLocal: true,
};

// Override the bootstrap function to ensure local kernel
document.addEventListener("DOMContentLoaded", function() {
    // Check if Thebe is loaded
    if (typeof thebelab !== 'undefined') {
        // Override default repository settings
        thebelab.on("status", function(evt, data) {
            console.log("Thebe status:", data.status, data.message);

            // If trying to build on Binder, cancel and use local
            if (data.status === "building" && data.message.includes("mybinder")) {
                console.log("Redirecting to local kernel...");
                evt.preventDefault();
                return false;
            }
        });
    }
});

// Function to set Jupyter token
function setJupyterToken(token) {
    window.localStorage.setItem('jupyter-token', token);
    console.log("Jupyter token saved. Refresh the page to use the new token.");
}

// Expose function globally
window.setJupyterToken = setJupyterToken;