import { Moon, Palette, Sun } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import { SettingsBlock, SettingsPanel, SettingRow } from "@/components/ui/Settings";
import { LoginBrandingSettings } from "@/components/LoginBrandingSettings";

export function AparenciaSection() {
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();
  return (
    <SettingsPanel icon={<Palette />} title="Tema da interface" description="Vale só para este navegador.">
      <SettingsBlock>
        <SettingRow label="Tema" hint="Claro ou escuro, como ficar mais confortável.">
          <div className="grid grid-cols-2 gap-2 sm:max-w-sm" role="radiogroup" aria-label="Tema da interface">
            {([
              { value: "light" as const, label: "Claro", icon: Sun },
              { value: "dark" as const, label: "Escuro", icon: Moon },
            ]).map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={theme === value}
                onClick={() => setTheme(value)}
                className={cn(
                  "flex h-11 items-center justify-center gap-2 rounded-xl border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500",
                  theme === value
                    ? "border-accent-500 bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300"
                    : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                )}
              >
                <Icon className="h-4 w-4" /> {label}
              </button>
            ))}
          </div>
        </SettingRow>
      </SettingsBlock>
      {user.role === "administrador" && (
        <SettingsBlock title="Tela de login" description="Personalização exibida para quem ainda não entrou no sistema.">
          <LoginBrandingSettings />
        </SettingsBlock>
      )}
    </SettingsPanel>
  );
}
