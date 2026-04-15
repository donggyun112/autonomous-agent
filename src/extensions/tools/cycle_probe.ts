export async function cycle_probe() {
  return {
    buildGate: 'WAKE 전이에는 build 1회가 필요하다',
    verifyGate: 'WAKE 전이에는 verify 1회가 필요하다',
    checkContinuityPresent: false,
    questionerAvailable: true,
  };
}