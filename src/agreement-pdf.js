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

window.generateAgreementPdf = async ({ text, dip, acceptedAt, signed }) => {
  const logo = await loadLogoDataUrl()
  const doc = new jsPDF({ format: 'a4', unit: 'mm', compress: true })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 18
  const contentWidth = pageWidth - margin * 2
  const title = signed ? 'Convenio aceptado' : 'Borrador de convenio'

  const drawHeader = () => {
    doc.addImage(logo, 'PNG', margin, 12, 42, 17)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(35, 54, 48)
    doc.text('Grupo de La Placeta', pageWidth - margin, 17, { align: 'right' })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(91, 108, 100)
    doc.text('Convenio de colaboración', pageWidth - margin, 22, { align: 'right' })
    doc.setDrawColor(217, 223, 220)
    doc.line(margin, 34, pageWidth - margin, 34)
  }

  drawHeader()
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(24, 44, 38)
  doc.text(title, margin, 43)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(72, 87, 80)

  let y = 52
  const rows = String(text || '').replace(/\r\n/g, '\n').split('\n')
  for (const row of rows) {
    const wrapped = doc.splitTextToSize(row || ' ', contentWidth)
    for (const line of wrapped) {
      if (y > pageHeight - 27) {
        doc.addPage()
        drawHeader()
        y = 43
      }
      doc.text(line, margin, y)
      y += 5
    }
  }

  if (y > pageHeight - 37) {
    doc.addPage()
    drawHeader()
    y = 43
  }
  doc.setDrawColor(217, 223, 220)
  doc.line(margin, y + 2, pageWidth - margin, y + 2)
  y += 9
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(signed ? 47 : 154, signed ? 125 : 112, signed ? 91 : 49)
  const signerText = signed
    ? `Firma electrónica interna mediante DIP: ${String(dip || 'no disponible').toUpperCase()}`
    : `BORRADOR · Pendiente de aceptación · DIP: ${String(dip || 'no disponible').toUpperCase()}`
  doc.text(doc.splitTextToSize(signerText, contentWidth), margin, y)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(91, 108, 100)
  doc.text(
    signed ? `Fecha y hora de aceptación: ${String(acceptedAt || 'no disponible')}` : 'Este documento no está firmado ni acredita una aceptación.',
    margin,
    y + 6,
  )

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
  const drawHeader = () => {
    doc.addImage(logo, 'PNG', margin, 12, 42, 17)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(35, 54, 48)
    doc.text('Grupo de La Placeta', pageWidth - margin, 17, { align: 'right' })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(91, 108, 100)
    doc.text('Resumen de nómina', pageWidth - margin, 22, { align: 'right' })
    doc.setDrawColor(217, 223, 220)
    doc.line(margin, 34, pageWidth - margin, 34)
  }
  const ensureSpace = (height = 8) => {
    if (y + height <= pageHeight - 22) return
    doc.addPage()
    drawHeader()
    y = 43
  }
  const writeText = (text, options = {}) => {
    const rows = doc.splitTextToSize(String(text || '—'), contentWidth)
    ensureSpace(rows.length * 5 + 2)
    doc.text(rows, margin, y, options)
    y += rows.length * 5 + 2
  }

  drawHeader()
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.setTextColor(24, 44, 38)
  doc.text(`Nómina · ${periodName}`, margin, 44)
  let y = 54
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(72, 87, 80)
  writeText(`Persona: ${contract.employeeName || payroll.employeeName || dip}`)
  writeText(`DIP: ${dip} · Puesto: ${contract.roleTitle || payroll.roleTitle || '—'} · Estado: ${state}`)
  writeText(`Cuenta de empresa: ${contract.companyAccountId || payroll.companyAccountId || '—'}`)
  y += 3

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(24, 44, 38)
  doc.text('Desglose de conceptos', margin, y)
  y += 6
  doc.setFontSize(8)
  doc.setTextColor(91, 108, 100)
  doc.text('Concepto', margin, y)
  doc.text('Tipo / estado', pageWidth - margin - 48, y)
  doc.text('Importe', pageWidth - margin, y, { align: 'right' })
  y += 3
  doc.setDrawColor(217, 223, 220)
  doc.line(margin, y, pageWidth - margin, y)
  y += 5
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(55, 70, 64)
  for (const item of lines) {
    const concept = doc.splitTextToSize(String(item.concepto || '—'), contentWidth - 68)
    const kind = `${item.tipo || '—'}${item.estado ? ` · ${item.estado}` : ''}`
    const height = Math.max(concept.length, 1) * 5 + 2
    ensureSpace(height)
    doc.text(concept, margin, y)
    doc.text(doc.splitTextToSize(kind, 43), pageWidth - margin - 48, y)
    doc.text(money(item.importePz), pageWidth - margin, y, { align: 'right' })
    y += height
  }

  y += 2
  doc.setDrawColor(217, 223, 220)
  doc.line(margin, y, pageWidth - margin, y)
  y += 7
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(55, 70, 64)
  writeText(`Salario base: ${money(payroll.basePz ?? summary.basePz)} · Complementos fijos: ${money(payroll.complementosFijosPz ?? summary.complementosFijosPz)} · Complementos de actividad: ${money(payroll.complementosActividadPz ?? summary.complementosActividadPz)}`)
  writeText(`Bruto: ${money(payroll.brutoPz ?? summary.brutoPz)} · Retención (${Number(payroll.retencionPct ?? summary.retencionPct) || 0}%): ${money(payroll.retencionesPz ?? summary.retencionesPz)} · Neto: ${money(payroll.netoPz ?? summary.netoPz)}`)
  writeText(`IAL empleador: ${money(employer.totalPz)} (valorización ${money(employer.valorizacionPz)} · Banco ${money(employer.bancoPz)})`)
  writeText(`IAL trabajador: ${money(employee.totalPz)} (antigüedad ${money(employee.antiguedadPz)} · Banco ${money(employee.bancoPz)})`)
  y += 4
  doc.setFontSize(8)
  doc.setTextColor(112, 124, 117)
  writeText('Documento informativo generado por Nexe. El estado de pago válido es el registrado en el Banco.')

  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(112, 124, 117)
    doc.text(`Nexe · Nómina ${periodName} · Página ${page} de ${pages}`, pageWidth / 2, pageHeight - 10, { align: 'center' })
  }

  const safeName = `${periodName}-${dip}`.replace(/[^a-z0-9-]/gi, '-')
  doc.save(`nomina-${safeName}.pdf`)
}
