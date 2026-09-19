import React, { useState, useEffect, useCallback } from 'react';
import { getMembers, createMember, updateMemberStatus, Member } from '../api/members.js';
import { RoleBadge } from './RoleBadge.js';
import {
  Users,
  UserPlus,
  Phone,
  Lock,
  UserCheck,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Power,
  RefreshCw,
} from 'lucide-react';

export const MemberManagement: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'list' | 'create'>('list');
  const [members, setMembers] = useState<Member[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Form state
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [initialPin, setInitialPin] = useState('1234');
  const [role, setRole] = useState<'MEMBER' | 'TREASURER'>('MEMBER');
  const [submitting, setSubmitting] = useState(false);

  // Fetch real members from backend
  const loadMembers = useCallback(async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const res = await getMembers(1, 50, statusFilter);
      if (res.success && res.data) {
        setMembers(res.data);
        if (res.pagination) {
          setTotalCount(res.pagination.total);
        } else {
          setTotalCount(res.data.length);
        }
      } else {
        setFeedback({
          type: 'error',
          message: res.error || 'सदस्य यादी लोड करता आली नाही.',
        });
      }
    } catch {
      setFeedback({
        type: 'error',
        message: 'सर्व्हरशी संपर्क होऊ शकला नाही.',
      });
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  // Handle member creation
  const handleCreateMember = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    const cleanedPhone = phone.trim().replace(/\D/g, '');
    if (!/^[6-9]\d{9}$/.test(cleanedPhone)) {
      setFeedback({ type: 'error', message: 'कृपया वैध १० अंकी मोबाईल नंबर प्रविष्ट करा.' });
      return;
    }

    if (!fullName.trim() || fullName.trim().length < 2) {
      setFeedback({ type: 'error', message: 'नाव किमान २ अक्षरांचे असणे आवश्यक आहे.' });
      return;
    }

    setSubmitting(true);
    try {
      const res = await createMember({
        fullName: fullName.trim(),
        phone: cleanedPhone,
        initialPin: initialPin.trim() || '1234',
        role,
      });

      if (res.success) {
        setFeedback({
          type: 'success',
          message: 'नवीन सदस्य यशस्वीरीत्या जोडला गेला!',
        });
        setFullName('');
        setPhone('');
        setInitialPin('1234');
        setRole('MEMBER');
        setActiveTab('list');
        loadMembers();
      } else {
        setFeedback({
          type: 'error',
          message: res.error || 'सदस्य जोडण्यात त्रुटी निर्माण झाली.',
        });
      }
    } catch {
      setFeedback({ type: 'error', message: 'नेटवर्क त्रुटी निर्माण झाली.' });
    } finally {
      setSubmitting(false);
    }
  };

  // Handle status toggle (Activate / Deactivate)
  const handleToggleStatus = async (member: Member) => {
    if (member.role === 'PRESIDENT') {
      setFeedback({ type: 'error', message: 'अध्यक्षांचे खाते निष्क्रिय करता येत नाही.' });
      return;
    }

    setActionLoading(member.id);
    setFeedback(null);
    const newStatus = !member.isActive;

    try {
      const res = await updateMemberStatus(member.id, newStatus);
      if (res.success && res.data) {
        setFeedback({
          type: 'success',
          message: newStatus
            ? `${member.fullName} यांचे खाते सक्रिय केले गेले.`
            : `${member.fullName} यांचे खाते निष्क्रिय केले गेले.`,
        });
        // Update state locally with real returned record
        setMembers((prev) =>
          prev.map((m) => (m.id === member.id ? { ...m, isActive: newStatus } : m))
        );
      } else {
        setFeedback({
          type: 'error',
          message: res.error || 'स्थिती बदलता आली नाही.',
        });
      }
    } catch {
      setFeedback({ type: 'error', message: 'सर्व्हरशी संपर्क होऊ शकला नाही.' });
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 space-y-3">
      {/* Header & Mode Switcher */}
      <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center">
            <Users className="w-4 h-4 text-orange-600" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-800 leading-tight">
              सदस्य व्यवस्थापन (Member Mgmt)
            </h3>
            <span className="text-[11px] text-slate-400">
              एकूण सदस्य: <strong className="text-slate-600">{totalCount}</strong>
            </span>
          </div>
        </div>

        {/* Tab Buttons */}
        <div className="flex bg-slate-100 p-0.5 rounded-lg text-xs font-semibold">
          <button
            onClick={() => {
              setActiveTab('list');
              setFeedback(null);
            }}
            className={`px-2.5 py-1 rounded-md transition-all ${
              activeTab === 'list'
                ? 'bg-white text-orange-600 shadow-sm font-bold'
                : 'text-slate-600 hover:text-slate-800'
            }`}
          >
            यादी
          </button>
          <button
            onClick={() => {
              setActiveTab('create');
              setFeedback(null);
            }}
            className={`px-2.5 py-1 rounded-md transition-all flex items-center gap-1 ${
              activeTab === 'create'
                ? 'bg-white text-orange-600 shadow-sm font-bold'
                : 'text-slate-600 hover:text-slate-800'
            }`}
          >
            <UserPlus className="w-3 h-3" />
            जोडा
          </button>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`p-2.5 rounded-xl border text-xs flex items-center gap-2 transition-all ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
          )}
          <span>{feedback.message}</span>
        </div>
      )}

      {/* TAB 1: Real Member Directory */}
      {activeTab === 'list' && (
        <div className="space-y-2.5">
          {/* Status Filter & Refresh */}
          <div className="flex items-center justify-between text-xs pt-1">
            <div className="flex gap-1.5">
              {(['all', 'active', 'inactive'] as const).map((filter) => (
                <button
                  key={filter}
                  onClick={() => setStatusFilter(filter)}
                  className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition-all ${
                    statusFilter === filter
                      ? 'bg-slate-800 text-white font-semibold'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {filter === 'all' && 'सर्व'}
                  {filter === 'active' && 'सक्रिय'}
                  {filter === 'inactive' && 'निष्क्रिय'}
                </button>
              ))}
            </div>

            <button
              onClick={loadMembers}
              disabled={loading}
              className="p-1 text-slate-400 hover:text-slate-600 transition-colors"
              title="रीफ्रेश करा"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Member List Cards */}
          {loading ? (
            <div className="py-8 flex flex-col items-center justify-center text-slate-400 gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-orange-600" />
              <span className="text-xs">डेटाबेसकडून माहिती आणत आहे...</span>
            </div>
          ) : members.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-400">
              या फिल्टरनुसार कोणतेही सदस्य आढळले नाहीत.
            </div>
          ) : (
            <div className="space-y-2 max-h-[360px] overflow-y-auto pr-0.5">
              {members.map((m) => (
                <div
                  key={m.id}
                  className={`p-3 rounded-xl border transition-all flex items-center justify-between gap-2 ${
                    m.isActive
                      ? 'bg-slate-50 border-slate-200'
                      : 'bg-slate-100/60 border-slate-200 opacity-60'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-slate-800 truncate">
                        {m.fullName}
                      </span>
                      {!m.isActive && (
                        <span className="px-1.5 py-0.2 rounded text-[10px] bg-red-100 text-red-700 font-semibold">
                          निष्क्रिय
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                      <span className="font-mono">+91 {m.phone}</span>
                      <span>•</span>
                      <RoleBadge role={m.role} className="scale-90 origin-left" />
                    </div>
                  </div>

                  {/* Status Toggle Button */}
                  {m.role !== 'PRESIDENT' && (
                    <button
                      onClick={() => handleToggleStatus(m)}
                      disabled={actionLoading === m.id}
                      title={m.isActive ? 'खाते निष्क्रिय करा' : 'खाते सक्रिय करा'}
                      className={`p-2 rounded-xl transition-all active:scale-95 ${
                        m.isActive
                          ? 'bg-emerald-100 hover:bg-red-100 text-emerald-700 hover:text-red-700'
                          : 'bg-slate-200 hover:bg-emerald-100 text-slate-600 hover:text-emerald-700'
                      }`}
                    >
                      {actionLoading === m.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Power className="w-4 h-4" />
                      )}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: Add Real Member Form */}
      {activeTab === 'create' && (
        <form onSubmit={handleCreateMember} className="space-y-3 pt-1">
          {/* Full Name */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              सदस्याचे पूर्ण नाव
            </label>
            <div className="relative flex items-center">
              <div className="absolute left-3 text-slate-400">
                <UserCheck className="w-4 h-4" />
              </div>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="उदा. रमेश प्रकाश पाटील"
                className="w-full pl-10 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all"
                required
              />
            </div>
          </div>

          {/* Mobile Number */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              मोबाईल नंबर (१० अंकी)
            </label>
            <div className="relative flex items-center">
              <div className="absolute left-3 flex items-center gap-1 text-slate-400">
                <Phone className="w-4 h-4" />
                <span className="text-xs font-semibold text-slate-600 border-r border-slate-300 pr-1.5">+91</span>
              </div>
              <input
                type="tel"
                maxLength={10}
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                placeholder="९८७६५४३२१०"
                className="w-full pl-20 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all"
                required
              />
            </div>
          </div>

          {/* Role Selection */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              भूमिका (Role)
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setRole('MEMBER')}
                className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all ${
                  role === 'MEMBER'
                    ? 'border-blue-400 bg-blue-50 text-blue-900 shadow-sm'
                    : 'border-slate-200 bg-slate-50 text-slate-600'
                }`}
              >
                सदस्य (Member)
              </button>
              <button
                type="button"
                onClick={() => setRole('TREASURER')}
                className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all ${
                  role === 'TREASURER'
                    ? 'border-emerald-400 bg-emerald-50 text-emerald-900 shadow-sm'
                    : 'border-slate-200 bg-slate-50 text-slate-600'
                }`}
              >
                खजिनदार (Treasurer)
              </button>
            </div>
          </div>

          {/* Initial PIN */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              प्रारंभिक सुरक्षा पिन (४-६ अंकी)
            </label>
            <div className="relative flex items-center">
              <div className="absolute left-3 text-slate-400">
                <Lock className="w-4 h-4" />
              </div>
              <input
                type="text"
                maxLength={6}
                value={initialPin}
                onChange={(e) => setInitialPin(e.target.value.replace(/\D/g, ''))}
                placeholder="1234"
                className="w-full pl-10 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium tracking-widest text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all"
                required
              />
            </div>
            <p className="text-[10px] text-slate-400 mt-1">
              सदस्य पहिल्यांदा लॉग इन करताना हा पिन वापरेल.
            </p>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 px-4 bg-orange-600 hover:bg-orange-700 active:scale-[0.98] text-white font-semibold rounded-xl text-xs shadow-md shadow-orange-600/20 flex items-center justify-center gap-1.5 transition-all disabled:opacity-60"
          >
            {submitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <UserPlus className="w-4 h-4" />
                <span>सदस्य नोंदणी पूर्ण करा</span>
              </>
            )}
          </button>
        </form>
      )}
    </div>
  );
};
