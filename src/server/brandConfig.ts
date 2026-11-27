import fs from "node:fs";
import path from "node:path";

export interface BrandConfig {
  id: string;
  partner: {
    name: string;
    shortName: string;
    credit: string;
    accentColor: string;
  };
  customer: {
    name: string;
    shortName: string;
    tagline: string;
  };
  logoUrl?: string;
  voicePersona: {
    greetingEn: string;
    greetingSv: string;
    greetingFr: string;
    fallbackPrompt: string;
  };
  compliance: {
    privacyNotice: string;
    showAdvisorHandoff: boolean;
  };
}

const defaultConfigRelativePath = "branding/helios.json";

function resolveConfigPath(): string {
  const configured = process.env.BRAND_CONFIG_FILE?.trim();
  const relative = configured && configured.length > 0 ? configured : defaultConfigRelativePath;
  return path.isAbsolute(relative) ? relative : path.resolve(process.cwd(), relative);
}

let cached: BrandConfig | null = null;

export function loadBrandConfig(): BrandConfig {
  if (cached) return cached;
  const configPath = resolveConfigPath();
  if (!fs.existsSync(configPath)) {
    throw new Error(`Brand config not found at ${configPath}. Set BRAND_CONFIG_FILE or add branding/helios.json.`);
  }
  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = JSON.parse(raw) as BrandConfig;
  cached = parsed;
  return parsed;
}
