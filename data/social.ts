interface SocialChannel {
  name: string;
  icon: string | null;
  href?: string;
}

export const socialChannels: readonly SocialChannel[] = [
  { name: "Facebook", icon: "facebook-color", href: "https://www.facebook.com/profile.php?id=61560913240742" },
  { name: "Instagram", icon: "instagram-color" },
  { name: "TikTok", icon: "tiktok-color", href: "https://www.tiktok.com/@jobsincroatiaa" },
  { name: "Threads", icon: "threads" },
  { name: "X", icon: "x" },
  { name: "Reddit", icon: "reddit-color" },
  { name: "Forums", icon: null },
];
