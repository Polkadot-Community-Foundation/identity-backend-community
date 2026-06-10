export const formatBigIntToDecimal = (decimals: number) => (bigIntValue: bigint): number => {
  // Convert the bigint to a string
  let bigIntStr = bigIntValue.toString()

  // If the number of decimal places is greater than the length of the string, pad with zeros
  if (decimals >= bigIntStr.length) {
    bigIntStr = bigIntStr.padStart(decimals + 1, '0')
  }

  // Insert the decimal point at the correct position
  const integerPart = bigIntStr.slice(0, -decimals) || '0'
  const fractionalPart = bigIntStr.slice(-decimals)

  return parseFloat(`${integerPart}.${fractionalPart}`)
}
