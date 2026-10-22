/** Official ThinkMade brand identity. Use these strings everywhere; never retype them. */
export const BRAND = {
  name: 'ThinkMade',
  tagline: 'Better Thinking. Made Personal.',
  promise: "Don't just learn more. Learn to think better.",
  shortDescription: 'Personalized podcasts that teach you how to think.',
  fullDescription:
    "ThinkMade transforms the world's best books and mental models into personalized podcasts that teach you how to think through whatever you're trying to learn or solve.",
  methodology: 'Thinking. Seeing. Doing.',
  productionUrl: 'https://thinkmade.zicaworld.com',
  colors: {
    warmIvory: '#F7F4EE',
    deepCharcoal: '#292929',
    terracotta: '#C56B4E',
    sageGreen: '#829284',
    softWhite: '#FFFFFF',
  },
} as const;

export type BrandColor = keyof typeof BRAND.colors;
