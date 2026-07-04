import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "Bitbucket Contribution Chart",
  version: "1.0.0",
  description:
    "GitHub-style contribution heatmap for your Bitbucket Cloud profile",
  icons: {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png",
  },
  action: {
    default_title: "Bitbucket Contribution Chart",
    default_icon: {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
    },
  },
  options_ui: {
    page: "src/options.html",
    open_in_tab: true,
  },
  permissions: ["storage", "tabs"],
  host_permissions: [
    "https://api.bitbucket.org/*",
    "https://bitbucket.org/*",
  ],
  background: {
    service_worker: "src/background.ts",
    type: "module",
  },
  content_scripts: [
    {
      matches: ["https://bitbucket.org/*"],
      js: ["src/content.ts"],
      css: ["styles/chart.css"],
      run_at: "document_idle",
    },
  ],
});
