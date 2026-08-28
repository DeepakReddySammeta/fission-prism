import React, { useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { AuthDialog } from '../../auth/AuthDialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8787';

interface Appointment {
  id: string;
  doctorName: string;
  specialty: string;
  hospitalName: string;
  patientName: string;
  preferredDate: string;
  preferredTime: string;
  appointmentRef: string;
  createdAt: string;
}

type DateFilter = 'all' | 'upcoming' | 'past';

function AppointmentCard({ appt }: { appt: Appointment }) {
  return (
    <div className="appt-card reveal">
      <div className="appt-card-body">
        <div className="appt-row">
          <div className="appt-left">
            <div className="appt-top">
              <h3 className="appt-doctor">{appt.doctorName}</h3>
              <Badge className="appt-specialty" variant="secondary">{appt.specialty}</Badge>
            </div>
            <p className="appt-hospital">{appt.hospitalName}</p>
            <p className="appt-patient">Patient: {appt.patientName}</p>
          </div>
          <div className="appt-right">
            <p className="appt-date">{formatDate(appt.preferredDate)} · {appt.preferredTime}</p>
            <Badge className="appt-ref" variant="outline">Booked · {appt.appointmentRef}</Badge>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
}

export default function InlineAppointments() {
  const { user, token, ready } = useAuth();
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [authOpen, setAuthOpen] = useState(false);

  useEffect(() => {
    if (!token) { setAppointments(null); return; }
    let cancelled = false;
    (async () => {
      const res = await fetch(`${API}/api/appointments?filter=${dateFilter}`, { headers: { authorization: `Bearer ${token}` } });
      const data: Appointment[] = res.ok ? await res.json() : [];
      if (!cancelled) setAppointments(data);
    })();
    return () => { cancelled = true; };
  }, [token, dateFilter]);

  if (!ready) return null;

  if (!user) {
    return (
      <div className="empty-state-box">
        <div className="empty-icon" aria-hidden>🔐</div>
        <h3>Sign in to continue</h3>
        <p>Sign in to see your upcoming and past appointments.</p>
        <Button onClick={() => setAuthOpen(true)}>Sign in</Button>
        <AuthDialog open={authOpen} onClose={() => setAuthOpen(false)} />
      </div>
    );
  }

  if (appointments === null) {
    return (
      <div className="empty-state-box">
        <div className="empty-icon" aria-hidden>⏳</div>
        <h3>Loading your appointments…</h3>
      </div>
    );
  }

  if (appointments.length === 0) {
    return (
      <div className="empty-state-box">
        <div className="empty-icon" aria-hidden>🩺</div>
        <h3>No appointments yet</h3>
        <p>Book a doctor appointment to see it here.</p>
      </div>
    );
  }

  return (
    <div className="inline-activity-section">
      <Tabs defaultValue="list">
        <div className="bookings-toolbar-wrap">
          <div className="bookings-tabs">
            <TabsList>
              <TabsTrigger value="list">
                All
                <span className="tab-count">{appointments.length}</span>
              </TabsTrigger>
            </TabsList>
          </div>
          <Select value={dateFilter} onValueChange={(v) => setDateFilter(v as DateFilter)}>
            <SelectTrigger className="bookings-select-trigger w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent className="bookings-select-content">
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="upcoming">Upcoming</SelectItem>
              <SelectItem value="past">Past</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <TabsContent value="list">
          <div className="bookings-content">
            <div className="appt-list stagger-reveal">
              {appointments.map((a, i) => (
                <div key={a.id} style={{ animationDelay: `${i * 60}ms` }}>
                  <AppointmentCard appt={a} />
                </div>
              ))}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
