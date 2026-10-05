import { jsPDF } from 'jspdf'

async function loadLogoDataUrl() {
  const response = await fetch('/nexe-logo.png')
  if (!response.ok) throw new Error(`No se pudo cargar el logo de Nexe (HTTP ${response.status}).`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return `data:image/png;base64,${btoa(binary)}`
}

async function loadParagraphFont(doc) {
  const response = await fetch('/plus-jakarta-sans.ttf')
  if (!response.ok) throw new Error(`No se pudo cargar Plus Jakarta Sans (HTTP ${response.status}).`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  doc.addFileToVFS('plus-jakarta-sans.ttf', btoa(binary))
  doc.addFont('plus-jakarta-sans.ttf', 'PlusJakartaSans', 'normal')
}

function drawLogo(doc, logo, x, y, maxWidth) {
  const { width, height } = doc.getImageProperties(logo)
  const renderedHeight = maxWidth * height / width
  doc.addImage(logo, 'PNG', x, y, maxWidth, renderedHeight)
}

function drawBrandHeader(doc, logo, pageWidth, margin, subtitle) {
  doc.setFillColor(20, 49, 45)
  doc.rect(0, 0, pageWidth, 3, 'F')
  doc.setFillColor(240, 180, 41)
  doc.rect(0, 3, pageWidth, 1, 'F')
  drawLogo(doc, logo, margin, 10, 48)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(20, 49, 45)
  doc.text('Grupo de La Placeta', pageWidth - margin, 16, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(95, 113, 109)
  doc.text(subtitle, pageWidth - margin, 22, { align: 'right' })
  doc.setDrawColor(217, 223, 220)
  doc.line(margin, 32, pageWidth - margin, 32)
}

window.generateAgreementPdf = async ({ text, dip, acceptedAt, signed }) => {
  const logo = await loadLogoDataUrl()
  const doc = new jsPDF({ format: 'a4', unit: 'mm', compress: true })
  await loadParagraphFont(doc)
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 18
  const contentWidth = pageWidth - margin * 2
  const title = signed ? 'Convenio aceptado' : 'Borrador de convenio'
  const footerY = pageHeight - 12
  let y = 44

  const drawHeader = () => {
    drawBrandHeader(doc, logo, pageWidth, margin, 'Convenio de colaboración')
  }
  const nextPage = () => {
    doc.addPage()
    drawHeader()
    doc.setFont('PlusJakartaSans', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(66, 78, 74)
    y = 42
  }
  const ensureSpace = height => {
    if (y + height <= footerY - 5) return
    nextPage()
  }

  drawHeader()
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.setTextColor(20, 49, 45)
  doc.text(title, margin, y)
  y += 9
  doc.setFont('PlusJakartaSans', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(66, 78, 74)

  const rows = String(text || '').replace(/\r\n/g, '\n').split('\n')
  for (const row of rows) {
    const wrapped = doc.splitTextToSize(row || ' ', contentWidth)
    for (const line of wrapped) {
      ensureSpace(5.5)
      doc.setFont('PlusJakartaSans', 'normal')
      doc.setFontSize(10)
      doc.setTextColor(66, 78, 74)
      doc.text(line, margin, y)
      y += 5.5
    }
  }

  const signerText = signed
    ? `Firma electrónica interna mediante DIP: ${String(dip || 'no disponible').toUpperCase()}`
    : `BORRADOR · Pendiente de aceptación · DIP: ${String(dip || 'no disponible').toUpperCase()}`
  const dateText = signed
    ? `Fecha y hora de aceptación: ${String(acceptedAt || 'no disponible')}`
    : 'Este documento no está firmado ni acredita una aceptación.'
  const signerLines = doc.splitTextToSize(signerText, contentWidth - 12)
  const dateLines = doc.splitTextToSize(dateText, contentWidth - 12)
  const signatureHeight = 12 + (signerLines.length + dateLines.length) * 5
  ensureSpace(signatureHeight + 4)
  doc.setFillColor(signed ? 236 : 255, signed ? 253 : 247, signed ? 243 : 237)
  doc.setDrawColor(signed ? 167 : 217, signed ? 215 : 223, signed ? 188 : 220)
  doc.roundedRect(margin, y, contentWidth, signatureHeight, 2, 2, 'FD')
  y += 7
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(signed ? 47 : 154, signed ? 125 : 112, signed ? 91 : 49)
  doc.text(signerLines, margin + 6, y)
  y += signerLines.length * 5
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(91, 108, 100)
  doc.text(dateLines, margin + 6, y + 1)

  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(112, 124, 117)
    doc.text(
      signed ? `Documento de Nexe · Página ${page} de ${pages}` : `Borrador sin firma · Página ${page} de ${pages}`,
      pageWidth / 2,
      pageHeight - 10,
      { align: 'center' },
    )
  }

  const safeDip = String(dip || 'identidad').replace(/[^a-z0-9-]/gi, '-')
  doc.save(`convenio-${signed ? 'aceptado' : 'borrador'}-${safeDip}.pdf`)
}

window.generatePayrollPdf = async ({ contract = {}, summary = {}, period }) => {
  const logo = await loadLogoDataUrl()
  const doc = new jsPDF({ format: 'a4', unit: 'mm', compress: true })
  await loadParagraphFont(doc)
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 18
  const contentWidth = pageWidth - margin * 2
  const payroll = summary.periodoDoc || summary
  const lines = payroll.lineas || summary.lineas || []
  const ial = payroll.ial || summary.ial || {}
  const employer = ial.empleador || {}
  const employee = ial.trabajador || {}
  const periodName = String(period || payroll.periodo || summary.periodo || '—')
  const dip = String(contract.employeeDip || payroll.employeeDip || '—')
  const state = String(payroll.status || payroll.estado || summary.estado || 'Open')
  const money = value => `${new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0)} Pz`
  const setParagraphStyle = (fontSize = 9, color = [45, 57, 53]) => {
    doc.setFont('PlusJakartaSans', 'normal')
    doc.setFontSize(fontSize)
    doc.setTextColor(...color)
  }
  const drawHeader = () => {
    drawBrandHeader(doc, logo, pageWidth, margin, 'Resumen de nómina')
  }
  let y = 42
  const ensureSpace = (height = 8, onPageBreak) => {
    if (y + height <= pageHeight - 22) return false
    doc.addPage()
    drawHeader()
    y = 42
    onPageBreak?.()
    return true
  }
  const writeText = (text, fontSize = 9, color = [45, 57, 53]) => {
    const rows = doc.splitTextToSize(String(text || '—'), contentWidth)
    rows.forEach(row => {
      ensureSpace(6)
      setParagraphStyle(fontSize, color)
      doc.text(row, margin, y)
      y += 5
    })
    y += 2
  }

  drawHeader()
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.setTextColor(20, 49, 45)
  const titleLines = doc.splitTextToSize(`Nómina · ${periodName}`, contentWidth)
  doc.text(titleLines, margin, y)
  y += titleLines.length * 7 + 3
  setParagraphStyle(9, [66, 78, 74])
  writeText(`Persona: ${contract.employeeName || payroll.employeeName || dip}`)
  writeText(`DIP: ${dip} · Puesto: ${contract.roleTitle || payroll.roleTitle || '—'} · Estado: ${state}`)
  writeText(`Cuenta de empresa: ${contract.companyAccountId || payroll.companyAccountId || '—'}`)

  const amountWidth = 32
  const kindWidth = 44
  const conceptWidth = contentWidth - amountWidth - kindWidth - 8
  const kindX = margin + conceptWidth + 4
  const drawBreakdownHeader = () => {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(20, 49, 45)
    doc.text('Desglose de conceptos', margin, y)
    y += 7
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(95, 113, 109)
    doc.text('Concepto', margin, y)
    doc.text('Tipo / estado', kindX, y)
    doc.text('Importe', pageWidth - margin, y, { align: 'right' })
    y += 3
    doc.setDrawColor(217, 223, 220)
    doc.line(margin, y, pageWidth - margin, y)
    y += 5
    setParagraphStyle()
  }
  ensureSpace(22)
  drawBreakdownHeader()
  for (const item of lines) {
    const concept = doc.splitTextToSize(String(item.concepto || '—'), conceptWidth)
    const kind = `${item.tipo || '—'}${item.estado ? ` · ${item.estado}` : ''}`
    const kindLines = doc.splitTextToSize(kind, kindWidth)
    const amountLines = doc.splitTextToSize(money(item.importePz), amountWidth)
    const rowLines = Math.max(concept.length, kindLines.length, amountLines.length, 1)
    const rowHeight = rowLines * 5 + 2
    if (rowHeight <= pageHeight - 64) ensureSpace(rowHeight, drawBreakdownHeader)
    for (let index = 0; index < rowLines; index += 1) {
      ensureSpace(5, drawBreakdownHeader)
      setParagraphStyle()
      if (concept[index]) doc.text(concept[index], margin, y)
      if (kindLines[index]) doc.text(kindLines[index], kindX, y)
      if (amountLines[index]) doc.text(amountLines[index], pageWidth - margin, y, { align: 'right', maxWidth: amountWidth })
      y += 5
    }
    y += 2
  }

  const summaryTexts = [
    `Salario base: ${money(payroll.basePz ?? summary.basePz)} · Complementos fijos: ${money(payroll.complementosFijosPz ?? summary.complementosFijosPz)} · Complementos de actividad: ${money(payroll.complementosActividadPz ?? summary.complementosActividadPz)}`,
    `Bruto: ${money(payroll.brutoPz ?? summary.brutoPz)} · Retención (${Number(payroll.retencionPct ?? summary.retencionPct) || 0}%): ${money(payroll.retencionesPz ?? summary.retencionesPz)} · Neto: ${money(payroll.netoPz ?? summary.netoPz)}`,
    `IAL empleador: ${money(employer.totalPz)} (valorización ${money(employer.valorizacionPz)} · Banco ${money(employer.bancoPz)})`,
    `IAL trabajador: ${money(employee.totalPz)} (antigüedad ${money(employee.antiguedadPz)} · Banco ${money(employee.bancoPz)})`,
  ]
  const disclaimer = 'Documento informativo generado por Nexe. El estado de pago válido es el registrado en el Banco.'
  const summaryHeight = 19 +
    summaryTexts.reduce((height, text) => height + doc.splitTextToSize(text, contentWidth).length * 5 + 2, 0) +
    doc.splitTextToSize(disclaimer, contentWidth).length * 5 + 2
  ensureSpace(summaryHeight)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(20, 49, 45)
  doc.text('Resumen de importes', margin, y)
  y += 7
  doc.setDrawColor(217, 223, 220)
  doc.line(margin, y, pageWidth - margin, y)
  y += 6
  summaryTexts.forEach(text => writeText(text))
  y += 4
  writeText(disclaimer, 8, [112, 124, 117])

  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(112, 124, 117)
    const footer = doc.splitTextToSize(`Nexe · Nómina ${periodName} · Página ${page} de ${pages}`, contentWidth)[0]
    doc.text(footer, pageWidth / 2, pageHeight - 10, { align: 'center' })
  }

  const safeName = `${periodName}-${dip}`.replace(/[^a-z0-9-]/gi, '-')
  doc.save(`nomina-${safeName}.pdf`)
}
