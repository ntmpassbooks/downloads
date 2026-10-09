import React, { useState, useEffect } from 'react';
import {
  X,
  Coins,
  AlertCircle,
  User,
  Calendar,
  Banknote,
  FileText,
  Save,
  Loader2,
} from 'lucide-react';
import { getMembers, Member } from '../api/members.js';
import { getMemberBishiRecords, BishiRecord } from '../api/bishi.js';
import { recordVarganiContribution, FinancialTransaction } from '../api/ledger.js';

interface RecordVarganiModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (transaction: FinancialTransaction) => void;
}

export const RecordVarganiModal: React.FC<RecordVarganiModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [contributionMode, setContributionMode] = useState<'MEMBER_BISHI' | 'GENERAL'>('MEMBER_BISHI');

  // Members list
  const [members, setMembers] = useState<Member[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState<string>('');

  // Member's pending bishi records
  const [memberRecords, setMemberRecords] = useState<BishiRecord[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [selectedRecordId, setSelectedRecordId] = useState<string>('');

  // Form inputs
  const [amount, setAmount] = useState<string>('');
  const [contributorName, setContributorName] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setAmount('');
      setContributorName('');
      setNotes('');
      setSelectedMemberId('');
      setSelectedRecordId('');
      setMemberRecords([]);
      fetchMembers();
    }
  }, [isOpen]);

  const fetchMembers = async () => {
    setMembersLoading(true);
    try {
      const res = await getMembers(1, 100);
      if (res.success && res.data) {
        setMembers(res.data.filter((m: Member) => m.isActive));
      }
    } catch {
      setError('सदस्य यादी लोड करताना अडचण आली.');
    } finally {
      setMembersLoading(false);
    }
  };

  // When member is selected in MEMBER_BISHI mode, fetch pending bishi records
  useEffect(() => {
    if (!selectedMemberId || contributionMode !== 'MEMBER_BISHI') {
      setMemberRecords([]);
      setSelectedRecordId('');
      return;
    }

    const fetchRecords = async () => {
      setRecordsLoading(true);
      try {
        const res = await getMemberBishiRecords(selectedMemberId);
        if (res.success && res.data) {
          const pending = res.data.filter((r) => r.status !== 'PAID');
          setMemberRecords(pending);
          if (pending.length > 0) {
            setSelectedRecordId(pending[0].id);
            setAmount(String(pending[0].expectedAmount));
            setNotes(`मासिक बीसी हप्ता - ${pending[0].monthYear}`);
          } else {
            setSelectedRecordId('');
            setAmount('');
            setNotes('');
          }
        }
      } catch {
        setError('सदस्याच्या बीसी नोंदी लोड करता आल्या नाहीत.');
      } finally {
        setRecordsLoading(false);
      }
    };

    fetchRecords();
  }, [selectedMemberId, contributionMode]);

  const handleRecordChange = (recordId: string) => {
    setSelectedRecordId(recordId);
    const rec = memberRecords.find((r) => r.id === recordId);
    if (rec) {
      setAmount(String(rec.expectedAmount));
      setNotes(`मासिक बीसी हप्ता - ${rec.monthYear}`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const amountNum = parseInt(amount, 10);
    if (isNaN(amountNum) || amountNum <= 0) {
      setError('कृपया वैध धन रक्कम प्रविष्ट करा.');
      return;
    }

    if (contributionMode === 'MEMBER_BISHI') {
      if (!selectedMemberId) {
        setError('कृपया सदस्य निवडा.');
        return;
      }
      if (!selectedRecordId) {
        setError('या सदस्याचा भरण्यासाठी कोणताही प्रलंबित बीसी हप्ता उपलब्ध नाही.');
        return;
      }
    } else {
      if (!selectedMemberId && !contributorName.trim()) {
        setError('कृपया सदस्याचे किंवा देणगीदाराचे नाव प्रविष्ट करा.');
        return;
      }
    }

    setSubmitting(true);
    try {
      const payload = {
        memberId: selectedMemberId || undefined,
        bishiRecordId: contributionMode === 'MEMBER_BISHI' ? selectedRecordId : undefined,
        amount: amountNum,
        paymentMethod: 'CASH' as const,
        notes: notes.trim() || undefined,
        contributorName: contributorName.trim() || undefined,
      };

      const res = await recordVarganiContribution(payload);
      if (res.success && res.data) {
        onSuccess(res.data);
        onClose();
      } else {
        setError(res.error || 'वर्गणी नोंदवताना अडचण आली.');
      }
    } catch {
      setError('सर्व्हरशी संपर्क होऊ शकला नाही.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto">
      <div className="relative w-full max-w-[calc(100vw-24px)] sm:max-w-md bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden my-auto animate-in fade-in zoom-in-95 duration-200">
        {/* Modal Header */}
        <div className="bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-3 sm:px-5 sm:py-4 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center backdrop-blur-xs shrink-0">
              <Coins className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-bold leading-tight truncate">+ वर्गणी / जमा नोंदवा</h3>
              <p className="text-[11px] text-emerald-100 mt-0.5 truncate">मंडळाच्या अधिकृत लेजरमध्ये जमा नोंद</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 rounded-2xl bg-white/10 hover:bg-white/20 active:scale-95 flex items-center justify-center transition-all min-h-[44px] min-w-[44px] shrink-0"
            aria-label="बंद करा"
          >
            <X className="w-5 h-5 text-white" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-3.5 sm:p-5 max-h-[calc(85vh-72px)] overflow-y-auto space-y-3.5 sm:space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-2xl flex items-start gap-2 text-xs text-red-700">
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Mode Switcher */}
          <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-2xl text-[11px] min-[360px]:text-xs font-bold">
            <button
              type="button"
              onClick={() => {
                setContributionMode('MEMBER_BISHI');
                setError(null);
              }}
              className={`min-h-[44px] py-2 px-2.5 sm:px-3 rounded-xl transition-all ${
                contributionMode === 'MEMBER_BISHI'
                  ? 'bg-white text-emerald-800 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              मासिक बीसी / हप्ता
            </button>
            <button
              type="button"
              onClick={() => {
                setContributionMode('GENERAL');
                setError(null);
                setSelectedRecordId('');
              }}
              className={`min-h-[44px] py-2 px-3 rounded-xl transition-all ${
                contributionMode === 'GENERAL'
                  ? 'bg-white text-emerald-800 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              विशेष वर्गणी / देणगी
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3.5">
            {/* Member Selection */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center gap-1">
                <User className="w-3.5 h-3.5 text-emerald-600" />
                <span>मंडळ सदस्य {contributionMode === 'MEMBER_BISHI' ? '*' : '(पर्यायी)'}</span>
              </label>
              {membersLoading ? (
                <div className="py-2.5 text-xs text-slate-400 flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>सदस्य यादी लोड होत आहे...</span>
                </div>
              ) : (
                <select
                  value={selectedMemberId}
                  onChange={(e) => setSelectedMemberId(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-hidden focus:border-emerald-500 transition-colors"
                >
                  <option value="">-- सदस्य निवडा --</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.fullName} (+91 {m.phone})
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Pending Bishi Record Selector (for MEMBER_BISHI mode) */}
            {contributionMode === 'MEMBER_BISHI' && selectedMemberId && (
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-emerald-600" />
                  <span>प्रलंबित बीसी महिना / हप्ता *</span>
                </label>
                {recordsLoading ? (
                  <div className="py-2.5 text-xs text-slate-400 flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>हप्ता तपशील तपासत आहे...</span>
                  </div>
                ) : memberRecords.length === 0 ? (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
                    या सदस्याचा भरण्यासाठी कोणताही प्रलंबित बीसी हप्ता उपलब्ध नाही.
                  </div>
                ) : (
                  <select
                    value={selectedRecordId}
                    onChange={(e) => handleRecordChange(e.target.value)}
                    className="w-full min-h-[44px] px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 font-mono focus:bg-white focus:outline-hidden focus:border-emerald-500 transition-colors"
                  >
                    {memberRecords.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.monthYear} — देय: ₹{r.expectedAmount} (देय तारीख:{' '}
                        {new Date(r.dueDate).toLocaleDateString('mr-IN', {
                          day: 'numeric',
                          month: 'short',
                        })}
                        )
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {/* Contributor Name (for GENERAL mode if not a member) */}
            {contributionMode === 'GENERAL' && !selectedMemberId && (
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center gap-1">
                  <User className="w-3.5 h-3.5 text-emerald-600" />
                  <span>देणगीदार / व्यक्तीचे नाव *</span>
                </label>
                <input
                  type="text"
                  required
                  value={contributorName}
                  onChange={(e) => setContributorName(e.target.value)}
                  placeholder="उदा. रमेश शिंदे किंवा मंडळाचे हितचिंतक"
                  className="w-full min-h-[44px] px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-hidden focus:border-emerald-500 transition-colors"
                />
              </div>
            )}

            {/* Amount Field */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center gap-1">
                <Banknote className="w-3.5 h-3.5 text-emerald-600" />
                <span>जमा रक्कम (₹) *</span>
              </label>
              <input
                type="number"
                min="1"
                step="1"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="उदा. 1000"
                className="w-full min-h-[44px] px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold font-mono text-slate-900 focus:bg-white focus:outline-hidden focus:border-emerald-500 transition-colors"
              />
            </div>

            {/* Payment Method Display */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                भरणा पद्धत
              </label>
              <div className="p-3 bg-emerald-50/80 border border-emerald-200 rounded-xl flex items-center justify-between text-xs font-bold text-emerald-900">
                <span>रोख भरणा (CASH)</span>
                <span className="text-[10px] bg-emerald-200/80 text-emerald-800 px-2 py-0.5 rounded-full">
                  अधिकृत रोख जमा
                </span>
              </div>
            </div>

            {/* Notes Field */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center gap-1">
                <FileText className="w-3.5 h-3.5 text-emerald-600" />
                <span>तपशील / नोंदी</span>
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="उदा. गणेशोत्सव वर्गणी / रोख हप्ता भरणा मिळाला"
                className="w-full min-h-[44px] px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-hidden focus:border-emerald-500 transition-colors"
              />
            </div>

            {/* Submit Button */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={submitting}
                className="w-full min-h-[48px] py-3 px-4 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 active:scale-98 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 disabled:opacity-50 transition-all"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>नोंदवत आहे...</span>
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    <span>वर्गणी अधिकृतपणे जमा करा</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
