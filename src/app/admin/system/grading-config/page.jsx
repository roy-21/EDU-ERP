"use client";

import { useState, useEffect } from "react";
import { systemService } from "@/lib/erpServices";

export default function GradingConfigPage() {
  // Initial state holding all grading configuration data
  const [config, setConfig] = useState({
    // Grading System Type Selection
    systemType: "standard_4", // standard_4, standard_5, custom
    
    // Global Settings
    gpaScale: "4.00",
    passMarks: 40,
    cgpaFormula: "standard_weighted", // standard_weighted, custom_logic

    // Dynamic Marks Range & Letter Grades Array
    gradeRanges: [
      { id: 1, letter: "A+", minMark: 80, maxMark: 100, gradePoint: 4.00 },
      { id: 2, letter: "A",  minMark: 75, maxMark: 79,  gradePoint: 3.75 },
      { id: 3, letter: "A-", minMark: 70, maxMark: 74,  gradePoint: 3.50 },
      { id: 4, letter: "B+", minMark: 65, maxMark: 69,  gradePoint: 3.25 },
      { id: 5, letter: "B",  minMark: 60, maxMark: 64,  gradePoint: 3.00 },
      { id: 6, letter: "B-", minMark: 55, maxMark: 59,  gradePoint: 2.75 },
      { id: 7, letter: "C+", minMark: 50, maxMark: 54,  gradePoint: 2.50 },
      { id: 8, letter: "C",  minMark: 40, maxMark: 49,  gradePoint: 2.00 },
      { id: 9, letter: "F",  minMark: 0,  maxMark: 39,  gradePoint: 0.00 },
    ],

    // Credit Configuration
    defaultCourseCredit: 3.00,
    minSemesterCredit: 12,
    maxSemesterCredit: 21,

    // Retake Policy Configuration
    retakePolicy: {
      isAllowed: true,
      maxRetakeAllowed: 2,
      applicableIfGradeBelow: "C", // Allow retake if grade is below this
    },

    // Improvement Policy Configuration
    improvementPolicy: {
      isAllowed: true,
      maxImprovementAllowed: 1,
      applicableIfGradeEqualOrAbove: "B-", // Allow improvement if grade is equal or above this
    }
  });

  const [saving, setSaving] = useState(false);
  const [notification, setNotification] = useState(null);

  // Load existing configuration from Core ERP Backend
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const res = await systemService.getGradingConfig();
        const data = res?.data || res;
        if (data && data.systemType) {
          setConfig(data);
        }
      } catch (err) {
        console.error("Failed to load grading config", err);
      }
    };
    loadConfig();
  }, []);

  // Handler to update top-level config fields
  const handleConfigChange = (key, value) => {
    setConfig({ ...config, [key]: value });
  };

  // Handler to update a specific grade row dynamically
  const handleGradeChange = (id, field, value) => {
    const updatedGrades = config.gradeRanges.map(grade => 
      grade.id === id ? { ...grade, [field]: value } : grade
    );
    setConfig({ ...config, gradeRanges: updatedGrades });
  };

  // Handler to add a new grade row
  const handleAddGrade = () => {
    const newId = Date.now();
    setConfig({
      ...config,
      gradeRanges: [
        ...config.gradeRanges,
        { id: newId, letter: "New", minMark: 0, maxMark: 0, gradePoint: 0.00 }
      ]
    });
  };

  // Handler to remove a grade row
  const handleRemoveGrade = (id) => {
    setConfig({
      ...config,
      gradeRanges: config.gradeRanges.filter(grade => grade.id !== id)
    });
  };

  // Handler to update nested policy objects
  const handlePolicyChange = (policyType, key, value) => {
    setConfig({
      ...config,
      [policyType]: { ...config[policyType], [key]: value }
    });
  };

  // Submit handler to send metadata to backend
  const handleSaveConfig = async () => {
    setSaving(true);
    try {
      await systemService.updateGradingConfig(config);
      setNotification({
        type: "success",
        message: "Grading policy saved for your institution."
      });
    } catch (err) {
      setNotification({
        type: "error",
        message: `Not saved: ${err.message}`
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto h-[calc(100vh-4rem)] overflow-y-auto">
      
      {/* Toast Notification */}
      {notification && (
        <div className={`mb-6 p-4 rounded-xl flex items-center justify-between text-sm shadow-sm transition-all ${
          notification.type === "success" ? "bg-emerald-50 text-emerald-800 border border-emerald-200" :
          "bg-rose-50 text-rose-800 border border-rose-200"
        }`}>
          <div className="flex items-center gap-2">
            <span className="font-semibold">{notification.type === "success" ? "Success:" : "Error:"}</span>
            <span>{notification.message}</span>
          </div>
          <button onClick={() => setNotification(null)} className="text-xs font-bold opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-3">
            <span className="p-2 bg-indigo-100 text-indigo-700 rounded-lg text-lg font-bold">🎓</span>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Academic Grading Configuration</h1>
              <p className="text-sm text-slate-500 mt-0.5">Define grading scale, CGPA calculation formula, retake rules & marks distribution.</p>
            </div>
          </div>
        </div>
        <button
          onClick={handleSaveConfig}
          disabled={saving}
          className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 shadow-md flex items-center gap-2 transition-all"
        >
          {saving ? (
            <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
          )}
          Save Grading System
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Global Settings & Credits */}
        <div className="lg:col-span-1 space-y-6">
          
          {/* Custom Grading System Selection */}
          <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
            <h3 className="text-sm font-bold text-slate-800 mb-4 border-b pb-2">Grading System Type</h3>
            <div className="space-y-2">
              {[
                { value: "standard_4", label: "Standard 4.00 Scale" },
                { value: "standard_5", label: "Standard 5.00 Scale" },
                { value: "custom", label: "Custom Grading System" }
              ].map(type => (
                <label key={type.value} className="flex items-center gap-3 p-2 border rounded-md cursor-pointer hover:bg-slate-50 transition-colors">
                  <input
                    type="radio"
                    name="systemType"
                    value={type.value}
                    checked={config.systemType === type.value}
                    onChange={(e) => handleConfigChange("systemType", e.target.value)}
                    className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-slate-700">{type.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Global Settings (GPA, Pass Marks, Formula) */}
          <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
            <h3 className="text-sm font-bold text-slate-800 mb-4 border-b pb-2">Global Settings</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">GPA Scale</label>
                <input
                  type="number"
                  step="0.01"
                  value={config.gpaScale}
                  onChange={(e) => handleConfigChange("gpaScale, e.target.value")}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500"
                  disabled={config.systemType !== "custom"}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Pass Marks (%)</label>
                <input
                  type="number"
                  value={config.passMarks}
                  onChange={(e) => handleConfigChange("passMarks", parseFloat(e.target.value))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">CGPA Calculation Formula</label>
                <select
                  value={config.cgpaFormula}
                  onChange={(e) => handleConfigChange("cgpaFormula", e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="standard_weighted">Standard Weighted Average</option>
                  <option value="custom_logic">Custom Logic (Advanced)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Credit Hour & Semester Credit */}
          <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
            <h3 className="text-sm font-bold text-slate-800 mb-4 border-b pb-2">Credit Configuration</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Default Course Credit Hour</label>
                <input
                  type="number"
                  step="0.5"
                  value={config.defaultCourseCredit}
                  onChange={(e) => handleConfigChange("defaultCourseCredit", parseFloat(e.target.value))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Min Semester Credit</label>
                  <input
                    type="number"
                    value={config.minSemesterCredit}
                    onChange={(e) => handleConfigChange("minSemesterCredit", parseInt(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Max Semester Credit</label>
                  <input
                    type="number"
                    value={config.maxSemesterCredit}
                    onChange={(e) => handleConfigChange("maxSemesterCredit", parseInt(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
          </div>

        </div>

        {/* Right Column: Dynamic Grade Table & Policies */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Marks Range & Letter Grade Table */}
          <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
            <div className="p-5 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800">Marks Range & Letter Grades</h3>
              <button
                onClick={handleAddGrade}
                className="text-xs bg-blue-50 text-blue-600 px-3 py-1.5 rounded-md font-medium hover:bg-blue-100 transition-colors border border-blue-200"
              >
                + Add Grade Row
              </button>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left p-3 font-medium text-slate-600 w-[20%]">Letter Grade</th>
                    <th className="text-left p-3 font-medium text-slate-600 w-[25%]">Min Mark (%)</th>
                    <th className="text-left p-3 font-medium text-slate-600 w-[25%]">Max Mark (%)</th>
                    <th className="text-left p-3 font-medium text-slate-600 w-[25%]">Grade Point</th>
                    <th className="p-3 w-[5%]"></th>
                  </tr>
                </thead>
                <tbody>
                  {config.gradeRanges.map((grade) => (
                    <tr key={grade.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                      <td className="p-2">
                        <input
                          type="text"
                          value={grade.letter}
                          onChange={(e) => handleGradeChange(grade.id, "letter", e.target.value)}
                          className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm font-semibold text-center focus:ring-2 focus:ring-blue-500"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="number"
                          value={grade.minMark}
                          onChange={(e) => handleGradeChange(grade.id, "minMark", parseInt(e.target.value))}
                          className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="number"
                          value={grade.maxMark}
                          onChange={(e) => handleGradeChange(grade.id, "maxMark", parseInt(e.target.value))}
                          className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="number"
                          step="0.01"
                          value={grade.gradePoint}
                          onChange={(e) => handleGradeChange(grade.id, "gradePoint", parseFloat(e.target.value))}
                          className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
                        />
                      </td>
                      <td className="p-2 text-center">
                        <button
                          onClick={() => handleRemoveGrade(grade.id)}
                          className="text-slate-400 hover:text-red-500 transition-colors"
                          title="Remove Grade"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Academic Policies (Retake & Improvement) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* Retake Policy Card */}
            <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-slate-800">Retake Policy</h3>
                <button
                  onClick={() => handlePolicyChange("retakePolicy", "isAllowed", !config.retakePolicy.isAllowed)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${config.retakePolicy.isAllowed ? "bg-blue-600" : "bg-slate-300"}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${config.retakePolicy.isAllowed ? "translate-x-6" : "translate-x-1"}`} />
                </button>
              </div>
              
              {config.retakePolicy.isAllowed && (
                <div className="space-y-4 mt-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Maximum Retakes Allowed</label>
                    <input
                      type="number"
                      value={config.retakePolicy.maxRetakeAllowed}
                      onChange={(e) => handlePolicyChange("retakePolicy", "maxRetakeAllowed", parseInt(e.target.value))}
                      className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Applicable if Grade is below</label>
                    <select
                      value={config.retakePolicy.applicableIfGradeBelow}
                      onChange={(e) => handlePolicyChange("retakePolicy", "applicableIfGradeBelow", e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 bg-white"
                    >
                      {config.gradeRanges.filter(g => g.letter !== "F").map(g => (
                        <option key={g.id} value={g.letter}>{g.letter} (Point: {g.gradePoint})</option>
                      ))}
                    </select>
                    <p className="text-[11px] text-slate-400 mt-1">Students can retake if they get a grade lower than this.</p>
                  </div>
                </div>
              )}
            </div>

            {/* Improvement Policy Card */}
            <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-slate-800">Improvement Policy</h3>
                <button
                  onClick={() => handlePolicyChange("improvementPolicy", "isAllowed", !config.improvementPolicy.isAllowed)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${config.improvementPolicy.isAllowed ? "bg-blue-600" : "bg-slate-300"}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${config.improvementPolicy.isAllowed ? "translate-x-6" : "translate-x-1"}`} />
                </button>
              </div>
              
              {config.improvementPolicy.isAllowed && (
                <div className="space-y-4 mt-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Maximum Improvements Allowed</label>
                    <input
                      type="number"
                      value={config.improvementPolicy.maxImprovementAllowed}
                      onChange={(e) => handlePolicyChange("improvementPolicy", "maxImprovementAllowed", parseInt(e.target.value))}
                      className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Applicable if Grade is equal or above</label>
                    <select
                      value={config.improvementPolicy.applicableIfGradeEqualOrAbove}
                      onChange={(e) => handlePolicyChange("improvementPolicy", "applicableIfGradeEqualOrAbove", e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 bg-white"
                    >
                      {config.gradeRanges.filter(g => g.letter !== "F").map(g => (
                        <option key={g.id} value={g.letter}>{g.letter} (Point: {g.gradePoint})</option>
                      ))}
                    </select>
                    <p className="text-[11px] text-slate-400 mt-1">Students can improve if they pass with this grade or higher.</p>
                  </div>
                </div>
              )}
            </div>

          </div>
        </div>

      </div>
    </div>
  );
}