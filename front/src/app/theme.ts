import { definePreset } from '@primeuix/themes';
import Aura from '@primeuix/themes/aura';

const Plane = definePreset(Aura, {
  semantic: {
    primary: {
      // 50: '{violet.50}',
      // 100: '{violet.100}',
      // 200: '{violet.200}',
      // 300: '{violet.300}',
      // 400: '{violet.400}',
      // 500: '{violet.500}',
      // 600: '{violet.600}',
      // 700: '{violet.700}',
      // 800: '{violet.800}',
      // 900: '{violet.900}',
      // 950: '{violet.950}',
      50: 'oklch(0.95 0.2 256)',
      100: 'oklch(0.9 0.2 256)',
      200: 'oklch(0.8 0.2 256)',
      300: 'oklch(0.7 0.2 256)',
      400: 'oklch(0.6 0.2 256)', // #007EFF
      500: 'oklch(0.5 0.2 256)',
      600: 'oklch(0.4 0.2 256)',
      700: 'oklch(0.3 0.2 256)',
      800: 'oklch(0.2 0.2 256)',
      900: 'oklch(0.1 0.2 256)',
      950: 'oklch(0.05 0.2 256)',
    },
    colorScheme: {
      light: {
        surface: {
          0: '#ffffff',
          50: '{zinc.50}',
          100: '{zinc.100}',
          200: '{zinc.200}',
          300: '{zinc.300}',
          400: '{zinc.400}',
          500: '{zinc.500}',
          600: '{zinc.600}',
          700: '{zinc.700}',
          800: '{zinc.800}',
          900: '{zinc.900}',
          950: '{zinc.950}',
        },
      },
      dark: {
        surface: {
          0: '#ffffff',
          // 50: '{slate.50}',
          // 100: '{slate.100}',
          // 200: '{slate.200}',
          // 300: '{slate.300}',
          // 400: '{slate.400}',
          // 500: '{slate.500}',
          // 600: '{slate.600}',
          // 700: '{slate.700}',
          // 800: '{slate.800}',
          // 900: '{slate.900}',
          // 950: '{slate.950}',
          50: 'oklch(0.97 0.003 250)',
          100: 'oklch(0.92 0.003 250)',
          200: 'oklch(0.84 0.004 250)',
          300: 'oklch(0.74 0.005 250)',
          400: 'oklch(0.64 0.006 250)',
          500: 'oklch(0.54 0.006 250)',
          600: 'oklch(0.44 0.006 250)',
          700: 'oklch(0.34 0.005 250)',
          800: 'oklch(0.26 0.004 250)',
          900: 'oklch(0.18 0.003 250)',
          950: 'oklch(0.12 0.003 250)',
        },
      },
    },
  },
});

export default Plane;
