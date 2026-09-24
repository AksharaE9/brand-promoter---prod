'use strict';
/**
 * inject_bgs_college_candidates.js
 *
 * Idempotent, transaction-safe script to inject BGS College candidates into ATS:
 * - Creates/reuses BGS College
 * - Creates/reuses single College Drive
 * - Injects Candidate + Application + Interview (Round 1) + InterviewFeedback + CollegeDriveCandidate
 * - Stamps each with source: 'BGS_COLLEGE_DRIVE_IMPORT'
 * - Supports --dry-run and --rollback
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const dbUrl = process.env.RENDER_DATABASE_URL || 
  'postgresql://ats_to2n_user:ixDs4gP0kpcwDfffaYASiVjJMIK7B7k0@dpg-d9kugflaeets73a88qhg-a.oregon-postgres.render.com/ats_to2n?sslmode=require';

const prisma = new PrismaClient({
  datasources: { db: { url: dbUrl } }
});

const IMPORT_SOURCE_TAG = 'BGS_COLLEGE_DRIVE_IMPORT';
const IMPORT_DATE = '2026-09-24';
const DRIVE_DATE = '2026-09-24';

const CANDIDATES_RAW = [
  {
    source_list: "Selected",
    source_row: 2,
    name: "Shamitha Krishna A",
    panelist_name: "Vinay Shetty",
    role: "Data Analyst Intern",
    family: "Mom - House wife ( classes for kids) Dad - LIC Agent  younger brother - 10th",
    from_place: "Bangalore",
    languages: "English Kannada",
    professional_exp: "Projects",
    timings: "9:30-7:00",
    location: "Bangalore",
    area: "Bangalore",
    rating: 7.5,
    doj: "28th Sept",
    status: "SELECTED",
    skills: "",
    comments: "She is a good candidate and also decent technical knowledge is a good fit for the role good in SQL excel"
  },
  {
    source_list: "Selected",
    source_row: 3,
    name: "Rakshitha S",
    panelist_name: "Vinay Shetty",
    role: "Data Analyst Intern",
    family: "Father - Tailor mother - home brother - studying",
    from_place: "Bangalore",
    languages: "English Kannada Marathi Hindi",
    professional_exp: "Internship - IT Solutions ( looking into database (Backend) ) storing database of customers",
    timings: "9:30-7:00",
    location: "Bangalore",
    area: "Rajajinagar",
    rating: 7,
    doj: "28th Sept",
    status: "SELECTED",
    skills: "Excel python",
    comments: "She has a decent technical knowledge but is willing to learn communication is good and was able to answer most of the questions ( if given her a bit training she can do well)"
  },
  {
    source_list: "Selected",
    source_row: 4,
    name: "Ekta V Dhanunjaya",
    panelist_name: "Vinay Shetty",
    role: "Data Analyst Intern",
    family: "Mom - professor father - structural engineer Brother - 10th",
    from_place: "Bangalore",
    languages: "English Hindi Kannada",
    professional_exp: "None",
    timings: "9:30-7:00",
    location: "Bangalore",
    area: "Rajajinagar",
    rating: 7,
    doj: "28th Sept",
    status: "SELECTED",
    skills: "",
    comments: "She is good with good technical knowledge good communication as well is a good fit for the role"
  },
  {
    source_list: "Selected",
    source_row: 5,
    name: "Amrutha",
    panelist_name: "Vinay Shetty",
    role: "Data Analyst Intern",
    family: "Father - Govt Employee Mom - House wife 4 siblings",
    from_place: "Bangalore",
    languages: "English Kannada Hindi",
    professional_exp: "virtual internship - Infosys ( Working on data of hospitals)",
    timings: "9:30-7:00",
    location: "Bangalore",
    area: "Vijayanagar",
    rating: 6,
    doj: "5th oct",
    status: "SELECTED",
    skills: "Excel SQL PowerBI",
    comments: "She is good candidate has average knowledge can do well if given training"
  },
  {
    source_list: "Selected",
    source_row: 6,
    name: "Vijetha A naik",
    panelist_name: "Vinay Shetty",
    role: "Data Analyst Intern",
    family: "Father - Cloud associative manager mom - house wiife sister - 10th",
    from_place: "Bangalore",
    languages: "English kannada",
    professional_exp: "Infosys",
    timings: "9:30-7:00",
    location: "Bangalore",
    area: "Nelmangala",
    rating: 7.5,
    doj: "28th Sept",
    status: "SELECTED",
    skills: "Excel SQL PowerBI python",
    comments: "She is good candidate has average knowledge can do well if given training"
  },
  {
    source_list: "Selected",
    source_row: 7,
    name: "Gaanavi B",
    panelist_name: "Vinay Shetty",
    role: "Data Analyst Intern",
    family: "Father - Business Mother - Govt Employee",
    from_place: "Bangalore",
    languages: "English Kannada Tamil Telugu",
    professional_exp: "None",
    timings: "9:30-7:00",
    location: "Bangalore",
    area: "Vijayanagar",
    rating: 4,
    doj: "28th Sept",
    status: "SELECTED",
    skills: "Python SQL Excel",
    comments: "She has average communication and good technical skills ( good fit if given training)"
  },
  {
    source_list: "Selected",
    source_row: 8,
    name: "Theertha varshini D",
    panelist_name: "Vinay Shetty",
    role: "Business Analyst Intern",
    family: "Father - DTL Mother - house wife sister",
    from_place: "Bangalore",
    languages: "English kannada hindi tamil",
    professional_exp: "None",
    timings: "9:30-7:00",
    location: "Bangalore",
    area: "Gayathrinagar",
    rating: 4,
    doj: "28th Sept",
    status: "SELECTED",
    skills: "c c++ Java oops python SQL Excel",
    comments: "Good candidate ( is interested to learn about the role ) also has a good necessary knowledge about the role"
  },
  {
    source_list: "Selected",
    source_row: 9,
    name: "Divya S B",
    panelist_name: "Vinay Shetty",
    role: "Data Analyst Intern",
    family: "Mother - Teacher Brother - JSS Grandmother",
    from_place: "Bangalore",
    languages: "English Kannada",
    professional_exp: "None",
    timings: "9:30-7:00",
    location: "Bangalore",
    area: "SR Nagar (Townhall)",
    rating: 7,
    doj: "28th Sept",
    status: "SELECTED",
    skills: "SQL Python Excel PowerBI",
    comments: "She is a bit soft but has good knowledge and is a fit for the DA role"
  },
  {
    source_list: "Selected",
    source_row: 10,
    name: "Bindu Shree S",
    panelist_name: "Vinay Shetty",
    role: "Data Analyst Intern",
    family: "Father - Manager Mother- Unit officer Sister - Bsc",
    from_place: "Bangalore",
    languages: "English Kannada Telugu",
    professional_exp: "Emerging Practitioner - IPEC Solutions",
    timings: "9:30-7:00",
    location: "Bangalore",
    area: "Yelhanka",
    rating: 7,
    doj: "28th Sept",
    status: "SELECTED",
    skills: "SQL Python Excel",
    comments: "communication is good and the tech knowledge is also good she is willing to learn as well"
  },
  {
    source_list: "Selected",
    source_row: 11,
    name: "Raksha G",
    panelist_name: "Vinay Shetty",
    role: "Data Analyst Intern",
    family: "Father - IT company Mother - House wife Brother",
    from_place: "Bangalore",
    languages: "English Kannada Hindi",
    professional_exp: "Infosys - Crowd monitoring system",
    timings: "9:30-7:00",
    location: "Bangalore",
    area: "Yelhanka",
    rating: 7,
    doj: "5th Oct",
    status: "SELECTED",
    skills: "SQL Python Excel",
    comments: "Good candidate with average tech knowledge but is willing to learn"
  },
  {
    source_list: "Selected",
    source_row: 12,
    name: "Devansh Verma",
    panelist_name: "Vinay Shetty",
    role: "Data Analyst Intern",
    family: "Father - Business Mom - House wife Elder brother - Business",
    from_place: "Bangalore",
    languages: "English Hindi Kannada",
    professional_exp: "None",
    timings: "9:30-7:00",
    location: "Bangalore",
    area: "Banshankri",
    rating: 7,
    doj: "5th Oct",
    status: "SELECTED",
    skills: "SQL Python Excel",
    comments: "He is a good candidate with good knowledge but he wants fully tech related in the role ( check into that)"
  },
  {
    source_list: "Selected",
    source_row: 13,
    name: "Sohan M",
    panelist_name: "Vinay Shetty",
    role: "Business Analyst Intern",
    family: "Father - Business Mom - House wife Elder brother - Business",
    from_place: "Bangalore",
    languages: "English Hindi Kannada",
    professional_exp: "HAL - Internship ( Building website )",
    timings: "9:30-7:00",
    location: "Bangalore",
    area: "Banshankri",
    rating: 7,
    doj: "5th Oct",
    status: "SELECTED",
    skills: "Python PowerBI",
    comments: "He is a good candidate, is active and is a good fit for the role"
  },
  {
    source_list: "Selected",
    source_row: 14,
    name: "Apeksha S",
    panelist_name: "Vinay Shetty",
    role: "Data Analyst Intern",
    family: "Father - Business Mom - Teacher ( govt school)",
    from_place: "Bangalore",
    languages: "English Hindi Kannada",
    professional_exp: "None",
    timings: "9:30-7:00",
    location: "Bangalore",
    area: "Nagasandra",
    rating: 7,
    doj: "5th Oct",
    status: "SELECTED",
    skills: "Python PowerBI | NumPy pandas sql ( Yolo, OpenCV)",
    comments: "He is a good candidate, is active and is a good fit for the role"
  },
  {
    source_list: "Selected",
    source_row: 15,
    name: "Vaishnavi",
    panelist_name: "Praneel",
    role: "Data Analyst Intern",
    family: "father - woodwork mother - homemaker",
    from_place: "Bangalore",
    languages: "English Kannada and telelgu",
    professional_exp: "none",
    timings: "9:30-7:00",
    location: "Bangalore",
    area: "",
    rating: 7,
    doj: "October",
    status: "SELECTED",
    skills: "",
    comments: "had good technical knowledge moderate communication skills sounds serious and dedicated"
  },
  {
    source_list: "Selected",
    source_row: 16,
    name: "Nisarga",
    panelist_name: "Praneel",
    role: "Data Analyst Intern",
    family: "dad - teacher mom - teacher twin sis her doing studying in cms",
    from_place: "Bangalore",
    languages: "English kannada telelgu",
    professional_exp: "none",
    timings: "9:30-7:00",
    location: "Bangalore",
    area: "",
    rating: 7,
    doj: "immediate",
    status: "SELECTED",
    skills: "",
    comments: "has really good knowledge in her field sounds very confident and answers well"
  },
  {
    source_list: "Selected",
    source_row: 17,
    name: "Pragathi GS",
    panelist_name: "Praneel",
    role: "Data Analyst Intern",
    family: "dad - business mom - home maker - twin sis - medicine",
    from_place: "Bangalore",
    languages: "Hindi English kannada",
    professional_exp: "none",
    timings: "9:30-7:00",
    location: "Bangalore",
    area: "",
    rating: 7,
    doj: "immediate",
    status: "SELECTED",
    skills: "",
    comments: "has really good knowledge in her field sounds very confident and answers well"
  },
  {
    source_list: "Selected",
    source_row: 18,
    name: "Yashwant kumar",
    panelist_name: "Praneel",
    role: "Data Analyst Intern",
    family: "dad - gold shop mom - retail shop",
    from_place: "Bangalore",
    languages: "Hindi English and kannnada",
    professional_exp: "none",
    timings: "9:30-7:00",
    location: "Bangalore",
    area: "",
    rating: 7,
    doj: "immediate",
    status: "SELECTED",
    skills: "",
    comments: "has really good technical knowledge and sounds confident and smart"
  },
  {
    source_list: "Selected",
    source_row: 19,
    name: "shamya MJ",
    panelist_name: "Praneel",
    role: "Data Analyst Intern",
    family: "dad - business , mom- housewife",
    from_place: "Bangalore",
    languages: "English kannada",
    professional_exp: "none",
    timings: "9:30-7:00",
    location: "Bangalore",
    area: "",
    rating: 7,
    doj: "immediate",
    status: "SELECTED",
    skills: "",
    comments: "she has really good technical knowledge and sounds confident and smart"
  },
  {
    source_list: "Selected",
    source_row: 20,
    name: "swati",
    panelist_name: "Praneel",
    role: "Data Analyst Intern",
    family: "mom - teacher",
    from_place: "Bangalore",
    languages: "English kannada Hindi",
    professional_exp: "none",
    timings: "9:30-7:00",
    location: "Bangalore",
    area: "",
    rating: 8,
    doj: "immediate",
    status: "SELECTED",
    skills: "",
    comments: "she has really good technical knowledge and sounds confident and smart"
  },
  {
    source_list: "Selected",
    source_row: 21,
    name: "chai l jain",
    panelist_name: "Praneel",
    role: "Data Analyst Intern",
    family: "dad - businessman jewellery - mum - house wife",
    from_place: "Bangalore",
    languages: "English kannada Hindi",
    professional_exp: "none",
    timings: "9:30-7:00",
    location: "Bangalore",
    area: "",
    rating: 9,
    doj: "immediate",
    status: "SELECTED",
    skills: "",
    comments: "she has really good technical knowledge and sounds confident and smart"
  },
  {
    source_list: "Selected",
    source_row: 22,
    name: "Santosh khul",
    panelist_name: "Praneel",
    role: "Data Analyst Intern",
    family: "",
    from_place: "Bangalore",
    languages: "",
    professional_exp: "none",
    timings: "9:30-7:00",
    location: "Bangalore",
    area: "",
    rating: 6,
    doj: "immediate",
    status: "SELECTED",
    skills: "",
    comments: "has good communication skills and technical knowledge",
    is_held: true
  },
  {
    source_list: "Selected",
    source_row: 23,
    name: "Bhumika S",
    panelist_name: "Praneel",
    role: "Data Analyst Intern",
    family: "",
    from_place: "Bangalore",
    languages: "",
    professional_exp: "none",
    timings: "9:30-7:00",
    location: "Bangalore",
    area: "",
    rating: 7,
    doj: "immediate",
    status: "SELECTED",
    skills: "",
    comments: "has good technical knowledge and answered all the asked questions so selected"
  },
  {
    source_list: "Selected",
    source_row: 24,
    name: "harshitha M Mary",
    panelist_name: "Praneel",
    role: "Data Analyst Intern",
    family: "",
    from_place: "Bangalore",
    languages: "",
    professional_exp: "none",
    timings: "9:30-7:00",
    location: "Bangalore",
    area: "",
    rating: 9,
    doj: "immediate",
    status: "SELECTED",
    skills: "",
    comments: "has good technical knowledge answer most of the questions sounds serious and dedecated so selected"
  },
  {
    source_list: "Selected",
    source_row: 25,
    name: "Sushmita TK",
    panelist_name: "Praneel",
    role: "Data Analyst Intern",
    family: "",
    from_place: "Bangalore",
    languages: "",
    professional_exp: "none",
    timings: "9:30-7:00",
    location: "Bangalore",
    area: "",
    rating: 8, // Column value 8 per Part 0.2 decision
    doj: "immediate",
    status: "SELECTED",
    skills: "",
    comments: "has good communication and technical knowledge and skill sounds dedicated and smart so selected 7/10"
  },
  {
    source_list: "Selected",
    source_row: 26,
    name: "hitha Sh",
    panelist_name: "Praneel",
    role: "Data Analyst Intern",
    family: "",
    from_place: "Bangalore",
    languages: "",
    professional_exp: "none",
    timings: "9:30-7:00",
    location: "Bangalore",
    area: "",
    rating: 8, // Inferred from comment "8/10" per Part 0.3 decision
    doj: "immediate",
    status: "SELECTED",
    skills: "",
    comments: "answers all the questions properly good communication also  so selected  8/10 date of joining November or  December"
  },
  {
    source_list: "Rejected",
    source_row: 2,
    name: "Yashaswini gowda",
    panelist_name: "Vinay Shetty",
    role: "Data Analyst Intern",
    family: "Father - Accountant mother - Accounatnt brother - Nitte (Engineering)",
    from_place: "Bangalore",
    languages: "English Kannada Telugu Tamil",
    professional_exp: "None",
    timings: "9:30-7:00",
    location: "Bangalore",
    area: "Vijayanagar",
    rating: 5,
    doj: "5th Sept",
    status: "REJECTED",
    skills: "",
    comments: "Communication is good but the technical knowledge is poor couldn't answer most of the questions as expected"
  },
  {
    source_list: "Rejected",
    source_row: 3,
    name: "N reddy Kumari",
    panelist_name: "Vinay Shetty",
    role: "Data Analyst Intern",
    family: "Married ( Andra Pradesh) Mother - Farmer Husband - Business",
    from_place: "Bangalore",
    languages: "English Telugu Kannada",
    professional_exp: "Part time (Sales and managing)",
    timings: "9:30-7:00",
    location: "Bangalore",
    area: "Vijayanagar",
    rating: 3,
    doj: "28th Sept",
    status: "REJECTED",
    skills: "",
    comments: "Her communication is average also she is not good at technical part not a good fit ( Already talking about leaving the company if she gets other offer)"
  },
  {
    source_list: "Rejected",
    source_row: 4,
    name: "Priyanka",
    panelist_name: "Vinay Shetty",
    role: "Data Analyst Intern",
    family: "Father - farmer mother  house wife",
    from_place: "Bangalore",
    languages: "English Kannada",
    professional_exp: "None",
    timings: "9:30-7:00",
    location: "Bangalore",
    area: "Shivmoga",
    rating: 3,
    doj: "28th Sept",
    status: "REJECTED",
    skills: "",
    comments: "She wants to be ML Engineer shes not interested"
  },
  {
    source_list: "Rejected",
    source_row: 5,
    name: "Dyuti",
    panelist_name: "Vinay Shetty",
    role: "Data Analyst Intern",
    family: "Mom -Teacher Dad - Home",
    from_place: "Bangalore",
    languages: "English Telugu Tamil Hindi Kannada",
    professional_exp: "Infosys Internship - AI Powered mock interviews",
    timings: "9:30-7:00",
    location: "Bangalore",
    area: "Vijayanagar",
    rating: 6,
    doj: "28th Sept",
    status: "REJECTED",
    skills: "",
    comments: "Communication is good is not much confident also is not that good in technical aspects"
  },
  {
    source_list: "Rejected",
    source_row: 6,
    name: "Nithyashree T R",
    panelist_name: "Vinay Shetty",
    role: "Data Analyst Intern",
    family: "Father - Repoter Mother - Teacher Brother - Bosch",
    from_place: "Bangalore",
    languages: "English kannada Telugu",
    professional_exp: "None",
    timings: "9:30-7:00",
    location: "Bangalore",
    area: "Nelmangala",
    rating: 4,
    doj: "28th Sept",
    status: "REJECTED",
    skills: "",
    comments: "Communication is good but technical knowledge is 0"
  },
  {
    source_list: "Rejected",
    source_row: 7,
    name: "Punya H",
    panelist_name: "Vinay Shetty",
    role: "Data Analyst Intern",
    family: "Father - Working Mother - Working  brother - Studying",
    from_place: "Bangalore",
    languages: "English kannada Hindi",
    professional_exp: "None",
    timings: "9:30-7:00",
    location: "Bangalore",
    area: "Girinagar",
    rating: 4,
    doj: "28th Sept",
    status: "REJECTED",
    skills: "Python SQL",
    comments: "Her technical skills is not that good her answers were more practical than technical"
  },
  {
    source_list: "Rejected",
    source_row: 8,
    name: "Shubha D C",
    panelist_name: "Vinay Shetty",
    role: "Business Analyst Intern",
    family: "Father - Farmer Mother - House wife Brother - BCom",
    from_place: "Bangalore",
    languages: "English Kannada Telugu Hindi",
    professional_exp: "None",
    timings: "9:30-7:00",
    location: "Bangalore",
    area: "Mahalaxminagar",
    rating: 4,
    doj: "28th Sept",
    status: "REJECTED",
    skills: "Python SQL Excel",
    comments: "Average communication and no much knowledge about the role"
  },
  {
    source_list: "Rejected",
    source_row: 9,
    name: "Sneha S",
    panelist_name: "Vinay Shetty",
    role: "Data Analyst Intern",
    family: "Father - Architect Mom - House wife Brother - 2nd PU",
    from_place: "Bangalore",
    languages: "English Kannada Hindi",
    professional_exp: "Skillcraft technology",
    timings: "9:30-7:00",
    location: "Bangalore",
    area: "Mudalpalya",
    rating: 6,
    doj: "28th Sept",
    status: "REJECTED",
    skills: "SQL Excel Python",
    comments: "Candidate has decent knowledge also she's not much interested in the role she is looking for ML roles"
  },
  {
    source_list: "Rejected",
    source_row: 10,
    name: "Deekshitha M",
    panelist_name: "Vinay Shetty",
    role: "Data Analyst Intern",
    family: "Brother - IIT Father - Work Mother - House wife",
    from_place: "Bangalore",
    languages: "English Kannada Telugu",
    professional_exp: "AADS - company database handling , AISLYN ( python backend developer)",
    timings: "9:30-7:00",
    location: "Bangalore",
    area: "Nice road",
    rating: 5,
    doj: "28th Sept",
    status: "REJECTED",
    skills: "SQL Python Excel",
    comments: "No tech knowledge, low confidence"
  },
  {
    source_list: "Rejected",
    source_row: 11,
    name: "Vinutha V",
    panelist_name: "Praneel",
    role: "Data Analyst Intern",
    family: "dad- business mom - homemaker",
    from_place: "Bangalore",
    languages: "English kannada telelgu",
    professional_exp: "none",
    timings: "9:30-7:00",
    location: "Bangalore",
    area: "",
    rating: 7,
    doj: "immediate",
    status: "REJECTED",
    skills: "",
    comments: "was very nervous did not answer properly moderate communication skills"
  },
  {
    source_list: "Rejected",
    source_row: 12,
    name: "saniya B K",
    panelist_name: "Praneel",
    role: "Data Analyst Intern",
    family: "dad - manager   mom - house wife",
    from_place: "Bangalore",
    languages: "kannada English Hindi",
    professional_exp: "interned as web disgner",
    timings: "9:30-7:00",
    location: "Bangalore",
    area: "",
    rating: 5,
    doj: "immediate",
    status: "REJECTED",
    skills: "",
    comments: "dint answer most questions was not good with her communication as well"
  },
  {
    source_list: "Rejected",
    source_row: 13,
    name: "manushree",
    panelist_name: "Praneel",
    role: "Data Analyst Intern",
    family: "dad - teacher   mom - teacher",
    from_place: "Bangalore",
    languages: "English , kannada",
    professional_exp: "none",
    timings: "9:30-7:00",
    location: "banglore",
    area: "",
    rating: 4,
    doj: "immediate",
    status: "REJECTED",
    skills: "",
    comments: "did not  answer or understand most questions was not good with her communication as well"
  },
  {
    source_list: "Rejected",
    source_row: 14,
    name: "Sachin j",
    panelist_name: "Praneel",
    role: "Data Analyst Intern",
    family: "dad -supermarket manager  mom - house wife",
    from_place: "Bangalore",
    languages: "English and Hindi and kannada",
    professional_exp: "none",
    timings: "9:30-7:00",
    location: "Bangalore",
    area: "",
    rating: 5,
    doj: "immediate",
    status: "REJECTED",
    skills: "",
    comments: "very bad at communication"
  },
  {
    source_list: "Rejected",
    source_row: 15,
    name: "Niranjan k",
    panelist_name: "Praneel",
    role: "Data Analyst Intern",
    family: "dad - business   mom - housewife",
    from_place: "Bangalore",
    languages: "kannada Hindi English",
    professional_exp: "none",
    timings: "9:30-7:00",
    location: "Bangalore",
    area: "",
    rating: 5,
    doj: "immediate",
    status: "REJECTED",
    skills: "",
    comments: "very moderate communication skills gave the interview for the sake of it"
  },
  {
    source_list: "Rejected",
    source_row: 16,
    name: "Abilash PA",
    panelist_name: "Praneel",
    role: "Data Analyst Intern",
    family: "agriculture",
    from_place: "Bangalore",
    languages: "English kannada telegu",
    professional_exp: "none",
    timings: "9:30-7:00",
    location: "Bangalore",
    area: "",
    rating: 5,
    doj: "immediate",
    status: "REJECTED",
    skills: "",
    comments: "did not answer most of the questions properly"
  },
  {
    source_list: "Rejected",
    source_row: 17,
    name: "Arvind",
    panelist_name: "Praneel",
    role: "Data Analyst Intern",
    family: "",
    from_place: "Bangalore",
    languages: "",
    professional_exp: "none",
    timings: "9:30-7:00",
    location: "Bangalore",
    area: "",
    rating: 4,
    doj: "immediate",
    status: "REJECTED",
    skills: "",
    comments: "has no communication skills dose not know any technical questions"
  },
  {
    source_list: "Rejected",
    source_row: 18,
    name: "Santosh khul",
    panelist_name: "Praneel",
    role: "Data Analyst Intern",
    family: "",
    from_place: "Bangalore",
    languages: "",
    professional_exp: "none",
    timings: "9:30-7:00",
    location: "Bangalore",
    area: "",
    rating: 2,
    doj: "immediate",
    status: "REJECTED",
    skills: "",
    comments: "has moderate communication skills and technical skills",
    is_held: true
  },
  {
    source_list: "Rejected",
    source_row: 19,
    name: "PRATHIBHA KS",
    panelist_name: "Praneel",
    role: "Data Analyst Intern",
    family: "",
    from_place: "Bangalore",
    languages: "",
    professional_exp: "none",
    timings: "9:30-7:00",
    location: "Bangalore",
    area: "",
    rating: 4,
    doj: "immediate",
    status: "REJECTED",
    skills: "",
    comments: "Has no technical knowledge did not answer any of the questions that were asked"
  }
];

// Helper to slugify candidate for idempotent lookup
function slugify(name, row) {
  return `bgs_${IMPORT_DATE}_${row}_${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
}

async function rollback() {
  console.log('=== INITIATING ROLLBACK FOR BGS COLLEGE INJECTION ===');
  
  // Find candidates created with our import source tag
  const candidates = await prisma.candidate.findMany({
    where: { source: IMPORT_SOURCE_TAG },
    select: { id: true, fullName: true }
  });

  console.log(`Found ${candidates.length} candidates marked with ${IMPORT_SOURCE_TAG}.`);

  for (const cand of candidates) {
    await prisma.$transaction(async (tx) => {
      // Delete feedback
      await tx.interviewFeedback.deleteMany({ where: { candidateId: cand.id } });
      // Delete drive candidate
      await tx.collegeDriveCandidate.deleteMany({ where: { candidateId: cand.id } });
      // Find applications and interviews
      const apps = await tx.application.findMany({ where: { candidateId: cand.id } });
      for (const app of apps) {
        await tx.interview.deleteMany({ where: { applicationId: app.id } });
      }
      await tx.application.deleteMany({ where: { candidateId: cand.id } });
      await tx.candidate.delete({ where: { id: cand.id } });
    });
    console.log(`Deleted candidate: ${cand.fullName} (${cand.id})`);
  }

  // Check if BGS College Drive is empty
  const bgsDrive = await prisma.collegeDrive.findFirst({
    where: { title: 'BGS College Drive 2026' }
  });
  if (bgsDrive) {
    const driveCandCount = await prisma.collegeDriveCandidate.count({ where: { driveId: bgsDrive.id } });
    if (driveCandCount === 0) {
      await prisma.collegeDrive.delete({ where: { id: bgsDrive.id } });
      console.log(`Deleted empty college drive: ${bgsDrive.title} (${bgsDrive.id})`);
    }
  }

  // Check if BGS College has any drives
  const bgsCollege = await prisma.college.findFirst({
    where: { name: 'BGS College' }
  });
  if (bgsCollege) {
    const drivesCount = await prisma.collegeDrive.count({ where: { collegeId: bgsCollege.id } });
    if (drivesCount === 0) {
      await prisma.college.delete({ where: { id: bgsCollege.id } });
      console.log(`Deleted college: ${bgsCollege.name} (${bgsCollege.id})`);
    }
  }

  console.log('✅ ROLLBACK COMPLETED SUCCESSFULLY.');
}

async function runInjection(isDryRun = false) {
  console.log(`=== BGS COLLEGE INJECTION RUN [Mode: ${isDryRun ? 'DRY-RUN' : 'LIVE PRODUCTION'}] ===`);
  
  // 1. Resolve Users
  const users = await prisma.user.findMany({
    select: { id: true, fullName: true, email: true, role: true }
  });
  const vinayUser = users.find(u => /vinay/i.test(u.fullName));
  const praneelUser = users.find(u => /praneel/i.test(u.fullName));

  if (!vinayUser || !praneelUser) {
    throw new Error(`Could not resolve panelists: Vinay=${vinayUser?.id}, Praneel=${praneelUser?.id}`);
  }
  console.log(`Panelist Vinay Shetty resolved -> User ID: ${vinayUser.id} (${vinayUser.fullName})`);
  console.log(`Panelist Praneel resolved -> User ID: ${praneelUser.id} (${praneelUser.fullName})`);

  // 2. Resolve Jobs
  const jobs = await prisma.job.findMany({
    where: { isActive: true },
    select: { id: true, title: true }
  });
  const daJob = jobs.find(j => j.title.trim().toLowerCase() === 'data analyst intern');
  const baJob = jobs.find(j => j.title.trim().toLowerCase() === 'business analyst intern');

  if (!daJob || !baJob) {
    throw new Error(`Could not resolve jobs: DA=${daJob?.id}, BA=${baJob?.id}`);
  }
  console.log(`Job "Data Analyst Intern" resolved -> ID: ${daJob.id}`);
  console.log(`Job "Business Analyst Intern" resolved -> ID: ${baJob.id}`);

  // 3. Resolve / Create BGS College
  let bgsCollege = await prisma.college.findFirst({
    where: { name: { equals: 'BGS College', mode: 'insensitive' } }
  });

  if (!bgsCollege) {
    if (!isDryRun) {
      bgsCollege = await prisma.college.create({
        data: {
          name: 'BGS College',
          location: 'Bangalore',
          role: 'Data Analyst Intern, Business Analyst Intern',
          course: 'Any',
          createdById: vinayUser.id
        }
      });
      console.log(`Created College "BGS College" -> ID: ${bgsCollege.id}`);
    } else {
      bgsCollege = { id: 'dry-run-college-id', name: 'BGS College' };
      console.log(`[DRY-RUN] Would create College "BGS College"`);
    }
  } else {
    console.log(`Found existing College "BGS College" -> ID: ${bgsCollege.id}`);
  }

  // 4. Resolve / Create BGS College Drive
  let bgsDrive = await prisma.collegeDrive.findFirst({
    where: { 
      collegeId: bgsCollege.id,
      isDeleted: false
    }
  });

  if (!bgsDrive) {
    if (!isDryRun) {
      bgsDrive = await prisma.collegeDrive.create({
        data: {
          title: 'BGS College Drive 2026',
          collegeId: bgsCollege.id,
          dateFrom: DRIVE_DATE,
          dateTo: DRIVE_DATE,
          status: 'COMPLETED',
          description: 'Single college drive covering Round 1 interviews for 43 candidates at BGS College',
          ownerId: vinayUser.id,
          recruiters: [vinayUser.id, praneelUser.id],
          linkedJobs: [daJob.id, baJob.id]
        }
      });
      console.log(`Created College Drive "BGS College Drive 2026" -> ID: ${bgsDrive.id}`);
    } else {
      bgsDrive = { id: 'dry-run-drive-id', title: 'BGS College Drive 2026' };
      console.log(`[DRY-RUN] Would create College Drive "BGS College Drive 2026"`);
    }
  } else {
    console.log(`Found existing College Drive -> ID: ${bgsDrive.id}`);
  }

  // 5. Sequential per-candidate atomic creation
  const createdRecords = [];
  const heldRecords = [];
  const skippedRecords = [];

  for (const c of CANDIDATES_RAW) {
    if (c.is_held) {
      console.log(`[HELD] ${c.name} (${c.source_list} Row ${c.source_row}) — Held for human decision.`);
      heldRecords.push(c);
      continue;
    }

    const assignedJob = c.role === 'Business Analyst Intern' ? baJob : daJob;
    const panelistUser = c.panelist_name.toLowerCase().includes('vinay') ? vinayUser : praneelUser;
    const slug = slugify(c.name, c.source_row);

    // Build comprehensive full comments (appending skills, timings, doj notes where applicable)
    let fullComments = c.comments || '';
    const extraParts = [];
    if (c.skills && c.skills.trim().length > 0) extraParts.push(`Skills: ${c.skills.trim()}`);
    if (c.timings && c.timings.trim().length > 0) extraParts.push(`Timings: ${c.timings.trim()}`);
    if (c.doj && c.doj.trim().length > 0) extraParts.push(`DOJ: ${c.doj.trim()}`);
    if (c.family && c.family.trim().length > 0) extraParts.push(`Family: ${c.family.trim()}`);
    if (c.languages && c.languages.trim().length > 0) extraParts.push(`Languages: ${c.languages.trim()}`);
    if (c.professional_exp && c.professional_exp.trim().length > 0 && c.professional_exp !== 'None' && c.professional_exp !== 'none') {
      extraParts.push(`Prior Exp: ${c.professional_exp.trim()}`);
    }

    if (extraParts.length > 0) {
      fullComments = `${fullComments}\n\n[Recruiter Notes]\n${extraParts.join('\n')}`;
    }

    // Standardized feedback template data object
    const feedbackData = {
      name: c.name,
      number: '',
      roundNumber: 'Round 1',
      panelists: panelistUser.fullName,
      role: assignedJob.title,
      course: 'Any',
      family: c.family || '',
      college: 'BGS College',
      languagesKnown: c.languages || '',
      priorExperience: (c.professional_exp && c.professional_exp !== 'None' && c.professional_exp !== 'none') ? c.professional_exp : '',
      projects: '',
      location: c.location || 'Bangalore',
      area: c.area || '',
      overallRating: c.rating,
      doj: c.doj === 'immediate' ? 'Immediate' : (c.doj || 'Immediate'),
      timings: c.timings || '9:30-7:00',
      duration: 'Full Time',
      selectionStatus: c.status,
      comments: fullComments,
      offerLetterDocument: '',
      offerLetterEmailAttachment: ''
    };

    if (isDryRun) {
      console.log(`[DRY-RUN] Candidate: ${c.name} | Status: ${c.status} | Rating: ${c.rating} | Panelist: ${panelistUser.fullName} | Role: ${assignedJob.title}`);
      createdRecords.push({
        name: c.name,
        source_list: c.source_list,
        source_row: c.source_row,
        status: c.status,
        rating: c.rating,
        id: 'dry-run-id'
      });
      continue;
    }

    // Check idempotency in DB
    const existingCandidate = await prisma.candidate.findFirst({
      where: {
        fullName: c.name,
        source: IMPORT_SOURCE_TAG,
        isDeleted: false
      }
    });

    if (existingCandidate) {
      console.log(`[SKIPPED - ALREADY EXISTS] Candidate ${c.name} (${existingCandidate.id})`);
      skippedRecords.push({ name: c.name, id: existingCandidate.id });
      continue;
    }

    // Atomic transaction per candidate
    const result = await prisma.$transaction(async (tx) => {
      // 1. Create Candidate
      const candidate = await tx.candidate.create({
        data: {
          fullName: c.name,
          email: 'N/A',
          phone: null,
          college: 'BGS College',
          location: c.location || 'Bangalore',
          area: c.area || null,
          preferredRole: assignedJob.title,
          jobTitle: assignedJob.title,
          source: IMPORT_SOURCE_TAG,
          status: c.status === 'SELECTED' ? 'ACTIVE' : 'REJECTED',
          doj: c.doj || null,
          createdById: panelistUser.id,
          assignedRecruiterId: panelistUser.id,
          assignedRecruiterName: panelistUser.fullName,
          customFields: {
            needs_contact_details: true,
            source_file: `${c.source_list}_BGS_College.xlsx`,
            source_row: c.source_row,
            import_batch: `BGS_${IMPORT_DATE}`,
            import_slug: slug,
            timings: c.timings || null,
            languages: c.languages || null,
            family: c.family || null,
            skills: c.skills || null,
            raw_rating: c.rating,
            raw_doj: c.doj
          }
        }
      });

      // 2. Create Application
      const application = await tx.application.create({
        data: {
          candidateId: candidate.id,
          jobId: assignedJob.id,
          status: c.status === 'SELECTED' ? 'IN_PIPELINE' : 'REJECTED',
          joiningDate: c.doj || null
        }
      });

      // 3. Create Round 1 Interview
      const interviewDate = new Date(`${DRIVE_DATE}T10:00:00.000Z`);
      const interview = await tx.interview.create({
        data: {
          candidateId: candidate.id,
          candidateName: candidate.fullName,
          applicationId: application.id,
          jobId: assignedJob.id,
          jobTitle: assignedJob.title,
          roundNo: 1,
          round: 'Round 1',
          scheduledStart: interviewDate,
          durationMinutes: 60,
          mode: 'DRIVE',
          status: 'COMPLETED',
          result: c.status,
          outcome: c.status,
          outcomeSetAt: interviewDate,
          createdById: panelistUser.id,
          interviewerIds: [panelistUser.id],
          interviewerNames: panelistUser.fullName,
          notes: JSON.stringify({
            source: IMPORT_SOURCE_TAG,
            source_file: `${c.source_list}_BGS_College.xlsx`,
            source_row: c.source_row,
            college: 'BGS College',
            rating: c.rating
          }),
          feedback: [
            {
              round: 'ROUND_1',
              submittedById: panelistUser.id,
              submittedByName: panelistUser.fullName,
              selectionStatus: c.status,
              overallRating: c.rating,
              templateVersion: 1,
              feedbackData: feedbackData,
              createdAt: interviewDate.toISOString()
            }
          ]
        }
      });

      // 4. Create InterviewFeedback Record
      const feedback = await tx.interviewFeedback.create({
        data: {
          candidateId: candidate.id,
          round: 'ROUND_1',
          submittedById: panelistUser.id,
          templateVersion: 1,
          feedbackData: feedbackData,
          selectionStatus: c.status,
          overallRating: parseFloat(c.rating)
        }
      });

      // 5. Create CollegeDriveCandidate Record
      const driveCandidate = await tx.collegeDriveCandidate.create({
        data: {
          driveId: bgsDrive.id,
          candidateId: candidate.id,
          fullName: candidate.fullName,
          email: null,
          phone: '',
          status: c.status === 'SELECTED' ? 'SELECTED' : 'REJECTED'
        }
      });

      return { candidate, application, interview, feedback, driveCandidate };
    });

    console.log(`[CREATED] ${c.name} -> Candidate ID: ${result.candidate.id} | Interview ID: ${result.interview.id} | Status: ${c.status} | Rating: ${c.rating}`);
    createdRecords.push({
      name: c.name,
      source_list: c.source_list,
      source_row: c.source_row,
      status: c.status,
      rating: c.rating,
      candidateId: result.candidate.id,
      interviewId: result.interview.id,
      applicationId: result.application.id,
      feedbackId: result.feedback.id,
      role: assignedJob.title,
      panelist: panelistUser.fullName
    });

    // Brief pause to prevent memory/connection pressure on 512MB instance
    await new Promise(r => setTimeout(r, 60));
  }

  console.log('\n================ EXECUTION SUMMARY ================');
  console.log(`Total Input Candidates: ${CANDIDATES_RAW.length}`);
  console.log(`Created Candidates: ${createdRecords.length}`);
  console.log(`Held Candidates: ${heldRecords.length}`);
  console.log(`Skipped (Idempotency): ${skippedRecords.length}`);
  
  return { createdRecords, heldRecords, skippedRecords, bgsCollege, bgsDrive };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--rollback')) {
    await rollback();
  } else if (args.includes('--dry-run')) {
    await runInjection(true);
  } else {
    await runInjection(false);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
