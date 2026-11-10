import type { MetadataRoute } from "next";

// Lets people add MentorFlow to their Home Screen. On iPhone that is required
// for call notifications (Apple only allows web push for Home Screen apps).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MentorFlow",
    short_name: "MentorFlow",
    description: "Meaningful guidance and mentorship for entrepreneurs in Bhutan.",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f8fb",
    theme_color: "#5653c7",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
