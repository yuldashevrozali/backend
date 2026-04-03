export const calculateProbability = (theta: number, b: number): number => {
  return 1 / (1 + Math.exp(-(theta - b)));
};

export const updateTheta = (theta: number, isCorrect: boolean, b: number): number => {
  const k = 0.5;
  const P = calculateProbability(theta, b);
  return isCorrect ? theta + k * (1 - P) : theta - k * P;
};

export const calculateScore = (theta: number): number => {
  const raw = ((theta + 3) / 6) * 100;
  return Math.max(0, Math.min(100, raw)); // 0-100 oralig'iga cheklash
};

export const getGrade = (score: number): string => {
  if (score >= 85) return 'A+';
  if (score >= 75) return 'A';
  if (score >= 65) return 'B+';
  if (score >= 55) return 'B';
  if (score >= 45) return 'C+';
  return 'C';
};