import type { ForgeConfig } from "@electron-forge/shared-types";
import { VitePlugin } from "@electron-forge/plugin-vite";

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
  },

  rebuildConfig: {},

  makers: [
    {
      name: "@electron-forge/maker-squirrel",
    },
    {
      name: "@electron-forge/maker-zip",
      platforms: ["win32"],
    },
    {
      name: "@electron-forge/maker-deb",
    },
    {
      name: "@electron-forge/maker-rpm",
    },
  ],

  plugins: [
    new VitePlugin({
      build: [
        {
          entry: "src/main/main.ts",
          config: "vite.main.config.ts",
        },
        {
          entry: "src/main/preload.ts",
          config: "vite.preload.config.ts",
        },
      ],

      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.ts",
        },
      ],
    }),
  ],
};

export default config;