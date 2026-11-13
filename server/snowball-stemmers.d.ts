declare module 'snowball-stemmers' {
  export function newStemmer(language: 'russian'): { stem(word: string): string };
}
