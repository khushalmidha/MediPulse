import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { FileText, Download, Clock, CheckCircle, XCircle, AlertCircle } from 'lucide-react'
import jsPDF from 'jspdf'
import QRCode from 'qrcode'
import axios from 'axios'

const MyAppointments = () => {
  const [appointments, setAppointments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState('all')
  const { isAuth, user } = useAuth()
  const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8080'

  useEffect(() => {
    if (isAuth) {
      fetchAllAppointments()
    }
  }, [isAuth])

  const fetchAllAppointments = async () => {
    try {
      setLoading(true)
      const response = await axios.get(`${backendUrl}/appointment/history`, {
        withCredentials: true,
      })

      setAppointments(response.data.appointments || [])
      setError(null)
    } catch (err) {
      console.error('Error fetching appointments:', err)
      setError(err.response?.data?.message || err.message || 'Failed to fetch appointments')
    } finally {
      setLoading(false)
    }
  }

  const getStatusColor = (status) => {
    switch (status) {
      case 'active':
        return 'bg-yellow-100 text-yellow-800'
      case 'completed':
        return 'bg-green-100 text-green-800'
      case 'cancelled':
        return 'bg-red-100 text-red-800'
      case 'queued':
        return 'bg-blue-100 text-blue-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const getStatusIcon = (status) => {
    switch (status) {
      case 'active':
        return <Clock className="w-4 h-4" />
      case 'completed':
        return <CheckCircle className="w-4 h-4" />
      case 'cancelled':
        return <XCircle className="w-4 h-4" />
      case 'queued':
        return <AlertCircle className="w-4 h-4" />
      default:
        return null
    }
  }

  const downloadReceipt = async (appointment) => {
    try {
      if (!appointment.receiptText) {
        alert('Receipt not available for this appointment')
        return
      }

      const doc = new jsPDF()
      const pageWidth = doc.internal.pageSize.getWidth()
      const pageHeight = doc.internal.pageSize.getHeight()

      // Add watermark
      const watermarkText = 'MEDIPULSE'
      doc.setFont('Arial', 'bold')
      doc.setTextColor(200, 200, 200)
      doc.setFontSize(60)
      doc.text(watermarkText, pageWidth / 2, pageHeight / 2, {
        align: 'center',
        angle: -45,
        opacity: 0.1,
      })

      // Reset for content
      doc.setTextColor(0, 0, 0)
      let yPosition = 15

      // Header
      doc.setFontSize(16)
      doc.setFont('Arial', 'bold')
      doc.text('MediPulse Medical Receipt', pageWidth / 2, yPosition, { align: 'center' })

      yPosition += 10
      doc.setFontSize(10)
      doc.setFont('Arial', 'normal')
      doc.setTextColor(100, 100, 100)
      doc.text(`Website: ${window.location.origin}`, pageWidth / 2, yPosition, {
        align: 'center',
      })

      yPosition += 12

      // Appointment details
      doc.setTextColor(0, 0, 0)
      doc.setFont('Arial', 'bold')
      doc.setFontSize(11)
      doc.text('Appointment Details', 15, yPosition)

      yPosition += 8
      doc.setFont('Arial', 'normal')
      doc.setFontSize(9)

      const details = [
        `Appointment ID: ${appointment._id}`,
        `Doctor: ${appointment.doctor?.firstName} ${appointment.doctor?.lastName || 'N/A'}`,
        `Specialization: ${appointment.doctor?.specialization || 'N/A'}`,
        `Patient: ${user?.firstName} ${user?.lastName}`,
        `Date Booked: ${new Date(appointment.createdAt).toLocaleDateString()}`,
        `Status: ${appointment.status.toUpperCase()}`,
      ]

      details.forEach((detail) => {
        doc.text(detail, 15, yPosition)
        yPosition += 6
      })

      yPosition += 8

      // Receipt content
      doc.setFont('Arial', 'bold')
      doc.setFontSize(11)
      doc.text('Medical Notes', 15, yPosition)

      yPosition += 8
      doc.setFont('Arial', 'normal')
      doc.setFontSize(9)

      const wrappedText = doc.splitTextToSize(appointment.receiptText, pageWidth - 30)
      doc.text(wrappedText, 15, yPosition)

      yPosition += wrappedText.length * 5 + 10

      // Signature line
      if (yPosition > pageHeight - 30) {
        doc.addPage()
        yPosition = 15
      }

      doc.setDrawColor(100, 100, 100)
      doc.line(15, yPosition, pageWidth - 15, yPosition)
      yPosition += 3
      doc.setFont('Arial', 'normal')
      doc.setFontSize(8)
      doc.text('Doctor Signature', 15, yPosition)

      yPosition += 12

      // QR Code
      if (yPosition > pageHeight - 40) {
        doc.addPage()
        yPosition = 15
      }

      const qrData = {
        appointmentId: appointment._id,
        doctor: `${appointment.doctor?.firstName} ${appointment.doctor?.lastName}`,
        patient: `${user?.firstName} ${user?.lastName}`,
        date: new Date(appointment.createdAt).toLocaleDateString(),
        verified: true,
      }

      const qrDataString = JSON.stringify(qrData)
      const qrCanvas = await QRCode.toCanvas(qrDataString)
      const qrImage = qrCanvas.toDataURL('image/png')

      const qrWidth = 40
      doc.addImage(qrImage, 'PNG', pageWidth / 2 - qrWidth / 2, yPosition, qrWidth, qrWidth)

      yPosition += qrWidth + 5
      doc.setFontSize(8)
      doc.text('QR Code for Verification', pageWidth / 2, yPosition, { align: 'center' })

      // Footer
      doc.setTextColor(150, 150, 150)
      doc.setFontSize(7)
      doc.text('Generated by MediPulse - Healthcare Platform', pageWidth / 2, pageHeight - 5, {
        align: 'center',
      })

      // Download
      const fileName = `MediPulse_Receipt_${appointment._id.slice(-6)}.pdf`
      doc.save(fileName)
    } catch (err) {
      console.error('Error downloading receipt:', err)
      alert('Failed to download receipt')
    }
  }

  const filteredAppointments = appointments.filter((apt) => {
    if (activeTab === 'all') return true
    return apt.status === activeTab
  })

  if (!isAuth) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Please Log In</h2>
          <p className="text-gray-600">You need to be logged in to view your appointments.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">My Appointments</h1>
          <p className="text-gray-600">View all your bookings across all doctors</p>
        </div>

        {/* Tab Navigation */}
        <div className="bg-white rounded-lg shadow-sm mb-6 border border-gray-200">
          <div className="flex flex-wrap">
            {['all', 'queued', 'active', 'completed', 'cancelled'].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-6 py-3 font-medium text-sm transition-colors border-b-2 ${
                  activeTab === tab
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
                <span className="ml-2 text-xs bg-gray-100 px-2 py-1 rounded-full">
                  {appointments.filter((apt) => (tab === 'all' ? true : apt.status === tab)).length}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="bg-white rounded-lg shadow-sm p-8 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-4 text-gray-600">Loading your appointments...</p>
          </div>
        )}

        {/* Error State */}
        {error && !loading && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
            <p className="font-medium">Error loading appointments</p>
            <p className="text-sm mt-1">{error}</p>
            <button
              onClick={fetchAllAppointments}
              className="mt-3 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors text-sm"
            >
              Retry
            </button>
          </div>
        )}

        {/* Empty State */}
        {!loading && filteredAppointments.length === 0 && (
          <div className="bg-white rounded-lg shadow-sm p-12 text-center">
            <FileText className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-1">
              {activeTab === 'all'
                ? 'No appointments yet'
                : `No ${activeTab} appointments`}
            </h3>
            <p className="text-gray-600">
              {activeTab === 'all'
                ? 'Book an appointment with a doctor to get started'
                : `You don't have any ${activeTab} appointments`}
            </p>
          </div>
        )}

        {/* Appointments Grid */}
        {!loading && filteredAppointments.length > 0 && (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {filteredAppointments.map((appointment) => (
              <div
                key={appointment._id}
                className="bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow overflow-hidden border border-gray-200"
              >
                {/* Card Header */}
                <div className={`px-6 py-4 ${getStatusColor(appointment.status)}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      {getStatusIcon(appointment.status)}
                      <span className="font-medium text-sm capitalize">
                        {appointment.status}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Card Body */}
                <div className="px-6 py-4">
                  {/* Doctor Info */}
                  <div className="mb-4">
                    <h3 className="text-lg font-bold text-gray-900">
                      Dr. {appointment.doctor?.firstName} {appointment.doctor?.lastName}
                    </h3>
                    <p className="text-sm text-gray-600">
                      {appointment.doctor?.specialization || 'Medical Professional'}
                    </p>
                  </div>

                  {/* Details */}
                  <div className="space-y-2 mb-4 text-sm text-gray-700">
                    <div>
                      <span className="font-medium">Appointment ID:</span>
                      <p className="text-xs text-gray-500 font-mono">
                        {appointment._id.slice(-8)}
                      </p>
                    </div>
                    <div>
                      <span className="font-medium">Booked On:</span>
                      <p className="text-gray-600">
                        {new Date(appointment.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    {appointment.doctorNotes && (
                      <div>
                        <span className="font-medium">Notes:</span>
                        <p className="text-gray-600 text-xs mt-1 line-clamp-2">
                          {appointment.doctorNotes}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Receipt Download Button */}
                  {appointment.receiptText && (
                    <button
                      onClick={() => downloadReceipt(appointment)}
                      className="w-full flex items-center justify-center space-x-2 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors text-sm font-medium mt-4"
                    >
                      <Download className="w-4 h-4" />
                      <span>Download Receipt</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default MyAppointments
