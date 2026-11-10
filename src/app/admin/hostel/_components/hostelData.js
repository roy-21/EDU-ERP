
export const makeHostel = (
  id,
  title,
  category,
  date,
  status,
  description,
  extra = {}
) => ({
  id,
  title,
  category,
  date,
  status,
  description,
  ...extra,
});

export const hostelPages = {
  meals: {
    title: "Meal Management",
    subtitle: "Manage daily meal schedules, menus and student meal records.",
    type: "meals",
    records: [
      makeHostel("MEA-001", "Breakfast - Monday", "Breakfast", "2026-11-01", "Published", "Breakfast menu for hostel residents.", {
        menu: "Bread, Egg, Banana, Milk",
        servingTime: "07:00 AM - 08:30 AM",
        mealType: "Breakfast",
        cost: 50,
      }),
      makeHostel("MEA-002", "Lunch - Monday", "Lunch", "2026-11-01", "Published", "Lunch menu for hostel residents.", {
        menu: "Rice, Chicken, Dal, Vegetables",
        servingTime: "01:00 PM - 02:30 PM",
        mealType: "Lunch",
        cost: 100,
      }),
      makeHostel("MEA-003", "Dinner - Monday", "Dinner", "2026-11-01", "Draft", "Dinner menu awaiting publication.", {
        menu: "Rice, Fish, Dal, Salad",
        servingTime: "08:00 PM - 09:30 PM",
        mealType: "Dinner",
        cost: 90,
      }),
    ],
  },

  visitors: {
    title: "Visitor Management",
    subtitle: "Monitor hostel visitors and visit records.",
    type: "visitors",
    records: [
      makeHostel("VIS-001", "Abdul Karim", "Parent", "2026-10-28", "Checked Out", "Student guardian visit.", {
        student: "Rahim Ahmed",
        studentId: "STU-2024-001",
        phone: "01800000001",
        checkIn: "10:00 AM",
        checkOut: "11:15 AM",
        relation: "Father",
      }),
      makeHostel("VIS-002", "Fatema Begum", "Parent", "2026-10-29", "Checked In", "Student guardian currently visiting.", {
        student: "Nusrat Jahan",
        studentId: "STU-2024-018",
        phone: "01800000002",
        checkIn: "02:30 PM",
        checkOut: "Not checked out",
        relation: "Mother",
      }),
      makeHostel("VIS-003", "Mahmud Hasan", "Guest", "2026-10-29", "Pending", "Visitor waiting for approval.", {
        student: "Sakib Hasan",
        studentId: "STU-2026-009",
        phone: "01800000003",
        checkIn: "Not checked in",
        checkOut: "Not checked out",
        relation: "Uncle",
      }),
    ],
  },

  fees: {
    title: "Hostel Fee Management",
    subtitle: "Track hostel payments, dues and payment records.",
    type: "fees",
    records: [
      makeHostel("FEE-001", "Rahim Ahmed", "Monthly Hostel Fee", "2026-10-05", "Paid", "October hostel fee received.", {
        studentId: "STU-2024-001",
        month: "October 2026",
        amount: 4500,
        paidAmount: 4500,
        dueAmount: 0,
        paymentMethod: "Bank",
        transactionId: "TXN-10001",
      }),
      makeHostel("FEE-002", "Nusrat Jahan", "Monthly Hostel Fee", "2026-10-10", "Due", "October hostel fee is outstanding.", {
        studentId: "STU-2024-018",
        month: "October 2026",
        amount: 5000,
        paidAmount: 2000,
        dueAmount: 3000,
        paymentMethod: "Mobile Banking",
        transactionId: "TXN-10002",
      }),
      makeHostel("FEE-003", "Sakib Hasan", "Admission Fee", "2026-10-15", "Pending", "Admission fee payment is pending.", {
        studentId: "STU-2026-009",
        month: "Admission",
        amount: 3000,
        paidAmount: 0,
        dueAmount: 3000,
        paymentMethod: "Not Paid",
        transactionId: "N/A",
      }),
    ],
  },
};
