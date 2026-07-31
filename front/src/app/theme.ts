import { definePreset } from '@primeuix/themes';
import Aura from '@primeuix/themes/aura';

const Plane = definePreset(Aura, {
  primitive: {
    red: {
      50: 'oklch(0.96 0.07 8)',
      100: 'oklch(0.92 0.10 8)',
      200: 'oklch(0.86 0.15 8)',
      300: 'oklch(0.79 0.48 8)',
      400: 'oklch(0.71 0.48 8)',
      500: 'oklch(0.64 0.48 8)',
      600: 'oklch(0.57 0.48 8)',
      700: 'oklch(0.49 0.48 8)',
      800: 'oklch(0.40 0.48 8)',
      900: 'oklch(0.31 0.48 8)',
      950: 'oklch(0.22 0.48 8)',
    },
    green: {
      50: 'oklch(0.97 0.08 175)',
      100: 'oklch(0.93 0.11 175)',
      200: 'oklch(0.87 0.16 175)',
      300: 'oklch(0.80 0.21 175)',
      400: 'oklch(0.73 0.26 175)',
      500: 'oklch(0.66 0.30 175)',
      600: 'oklch(0.58 0.28 175)',
      700: 'oklch(0.50 0.25 175)',
      800: 'oklch(0.41 0.21 175)',
      900: 'oklch(0.32 0.16 175)',
      950: 'oklch(0.23 0.11 175)',
    },
    // `sky` alimenta severity="info" en PrimeNG: mismo hue que el primary
    // (256) para que "info" sea el mismo azul de marca, no el sky por
    // defecto de PrimeNG.
    sky: {
      50: 'oklch(0.95 0.2 256)',
      100: 'oklch(0.9 0.2 256)',
      200: 'oklch(0.8 0.2 256)',
      300: 'oklch(0.7 0.2 256)',
      400: 'oklch(0.6 0.2 256)',
      500: 'oklch(0.5 0.2 256)',
      600: 'oklch(0.4 0.2 256)',
      700: 'oklch(0.42 0.2 256)',
      800: 'oklch(0.2 0.2 256)',
      900: 'oklch(0.1 0.2 256)',
      950: 'oklch(0.05 0.2 256)',
    },
    // `purple` alimenta el tinte categórico de "Reading" en el historial:
    // misma escala de luminosidad que red/green, hue propio (violeta).
    purple: {
      50: 'oklch(0.97 0.02 300)',
      100: 'oklch(0.93 0.05 300)',
      200: 'oklch(0.87 0.09 300)',
      300: 'oklch(0.80 0.14 300)',
      400: 'oklch(0.72 0.19 300)',
      500: 'oklch(0.64 0.24 300)',
      600: 'oklch(0.56 0.22 300)',
      700: 'oklch(0.48 0.19 300)',
      800: 'oklch(0.39 0.16 300)',
      900: 'oklch(0.30 0.12 300)',
      950: 'oklch(0.21 0.08 300)',
    },
    // `orange` alimenta severity="warn" y el tinte de "Draft"/especulativo:
    // misma escala de luminosidad, hue naranja propio.
    orange: {
      50: 'oklch(0.97 0.03 55)',
      100: 'oklch(0.93 0.07 55)',
      200: 'oklch(0.87 0.11 55)',
      300: 'oklch(0.80 0.15 55)',
      400: 'oklch(0.73 0.17 55)',
      500: 'oklch(0.66 0.18 55)',
      600: 'oklch(0.58 0.17 55)',
      700: 'oklch(0.50 0.15 55)',
      800: 'oklch(0.41 0.12 55)',
      900: 'oklch(0.32 0.09 55)',
      950: 'oklch(0.23 0.06 55)',
    },
    // `amber` es la señal de "atención/pendiente" (GPU en carga media,
    // servidor iniciando, métrica aún sin dato): hue propio entre el
    // naranja de warn y el verde de éxito, para no confundir semánticas.
    amber: {
      50: 'oklch(0.97 0.04 85)',
      100: 'oklch(0.93 0.08 85)',
      200: 'oklch(0.87 0.12 85)',
      300: 'oklch(0.80 0.15 85)',
      400: 'oklch(0.73 0.16 85)',
      500: 'oklch(0.66 0.16 85)',
      600: 'oklch(0.58 0.15 85)',
      700: 'oklch(0.50 0.13 85)',
      800: 'oklch(0.41 0.10 85)',
      900: 'oklch(0.32 0.07 85)',
      950: 'oklch(0.23 0.05 85)',
    },
  },
  semantic: {
    primary: {
      50: 'oklch(0.95 0.2 256)',
      100: 'oklch(0.9 0.2 256)',
      200: 'oklch(0.8 0.2 256)',
      300: 'oklch(0.7 0.2 256)',
      400: 'oklch(0.6 0.2 256)', // #007EFF
      500: 'oklch(0.5 0.2 256)',
      600: 'oklch(0.4 0.2 256)',
      700: 'oklch(0.42 0.2 256)',
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
          50: 'oklch(0.97 0.003 250)',
          100: 'oklch(0.92 0.003 250)',
          200: 'oklch(0.84 0.004 250)',
          300: 'oklch(0.74 0.005 250)',
          400: 'oklch(0.64 0.006 250)',
          500: 'oklch(0.54 0.006 250)',
          600: '#404048',
          700: '#404048',
          800: '#2e2e34',
          900: '#111113',
          950: '#050505',
        },
      },
    },
  },
});

export default Plane;
